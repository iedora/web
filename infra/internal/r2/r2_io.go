package r2

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// NewFromEndpoint builds a Client against an explicit S3-compatible
// endpoint (e.g. `https://<account>.r2.cloudflarestorage.com`).
// Use when the caller already has the endpoint string (the backup
// binary reads S3_ENDPOINT from env). For the account-ID flavour
// see `New`.
func NewFromEndpoint(endpoint, accessKey, secretKey string) (*Client, error) {
	u, err := url.Parse(endpoint)
	if err != nil {
		return nil, fmt.Errorf("parse endpoint %q: %w", endpoint, err)
	}
	return &Client{
		httpClient: &http.Client{Timeout: 5 * time.Minute},
		endpoint:   u,
		accessKey:  accessKey,
		secretKey:  secretKey,
	}, nil
}

// Object is one entry in a ListObjects response — what the backup
// pruner needs to decide what to delete.
type Object struct {
	Key          string
	LastModified time.Time
	Size         int64
}

// ListObjects walks every object under `prefix` in `bucket` and
// returns them. Fully paginated (no truncation on the caller's side).
// Sorted by LastModified ascending — callers picking "the latest"
// take the last element; callers pruning anything older than a cutoff
// walk forward and stop at the first newer entry.
func (c *Client) ListObjects(ctx context.Context, bucket, prefix string) ([]Object, error) {
	var out []Object
	continuation := ""
	for {
		page, next, err := c.listPage(ctx, bucket, prefix, continuation)
		if err != nil {
			return nil, err
		}
		out = append(out, page...)
		if next == "" {
			break
		}
		continuation = next
	}
	// Insertion sort — list pages are already roughly time-ordered
	// (R2 returns in key order, and we use timestamped keys), so
	// this is near-O(n) in practice.
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j-1].LastModified.After(out[j].LastModified); j-- {
			out[j-1], out[j] = out[j], out[j-1]
		}
	}
	return out, nil
}

type listFullResult struct {
	XMLName  xml.Name `xml:"ListBucketResult"`
	Contents []struct {
		Key          string `xml:"Key"`
		LastModified string `xml:"LastModified"`
		Size         int64  `xml:"Size"`
	} `xml:"Contents"`
	NextContinuationToken string `xml:"NextContinuationToken"`
}

func (c *Client) listPage(ctx context.Context, bucket, prefix, continuation string) ([]Object, string, error) {
	u := *c.endpoint
	u.Path = "/" + bucket + "/"
	q := url.Values{}
	q.Set("list-type", "2")
	q.Set("max-keys", "1000")
	if prefix != "" {
		q.Set("prefix", prefix)
	}
	if continuation != "" {
		q.Set("continuation-token", continuation)
	}
	u.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, "", err
	}
	c.sign(req, emptyPayloadSHA)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("list %s/%s: HTTP %d: %s", bucket, prefix, resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var out listFullResult
	if err := xml.Unmarshal(body, &out); err != nil {
		return nil, "", fmt.Errorf("parse list XML: %w", err)
	}
	objects := make([]Object, 0, len(out.Contents))
	for _, e := range out.Contents {
		t, err := time.Parse(time.RFC3339, e.LastModified)
		if err != nil {
			// S3 sometimes emits the milliseconds variant.
			t, err = time.Parse("2006-01-02T15:04:05.000Z", e.LastModified)
			if err != nil {
				return nil, "", fmt.Errorf("parse LastModified %q: %w", e.LastModified, err)
			}
		}
		objects = append(objects, Object{Key: e.Key, LastModified: t, Size: e.Size})
	}
	return objects, out.NextContinuationToken, nil
}

// PutObject uploads `body` (exactly `size` bytes) to bucket/key. The
// body is buffered into memory so we can compute SigV4's
// payload-hash header in one pass — fine for backup dumps that are
// already on disk and bounded in size. For multi-gigabyte streams a
// future variant would use multipart upload.
func (c *Client) PutObject(ctx context.Context, bucket, key string, body []byte, contentType string) error {
	u := *c.endpoint
	u.Path = "/" + bucket + "/" + key

	req, err := http.NewRequestWithContext(ctx, http.MethodPut, u.String(), strings.NewReader(string(body)))
	if err != nil {
		return err
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	req.ContentLength = int64(len(body))

	sum := sha256.Sum256(body)
	c.sign(req, hex.EncodeToString(sum[:]))

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("put %s/%s: %w", bucket, key, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		errBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("put %s/%s: HTTP %d: %s", bucket, key, resp.StatusCode, strings.TrimSpace(string(errBody)))
	}
	return nil
}

// GetObject downloads bucket/key. Returns the full body (callers
// either decrypt-in-memory or write to a tempfile). For multi-GB
// objects a future variant would return io.ReadCloser to stream.
func (c *Client) GetObject(ctx context.Context, bucket, key string) ([]byte, error) {
	u := *c.endpoint
	u.Path = "/" + bucket + "/" + key

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	c.sign(req, emptyPayloadSHA)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("get %s/%s: %w", bucket, key, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		errBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("get %s/%s: HTTP %d: %s", bucket, key, resp.StatusCode, strings.TrimSpace(string(errBody)))
	}
	return io.ReadAll(resp.Body)
}

// DeleteObject is the public wrapper around deleteOne — the destroy
// path uses the internal lowercase form via EmptyBucket; the backup
// pruner needs the public version.
func (c *Client) DeleteObject(ctx context.Context, bucket, key string) error {
	return c.deleteOne(ctx, bucket, key)
}
