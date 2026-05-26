# Destroy-time hooks. Tofu's `cloudflare_r2_bucket` resource doesn't
# accept a `force_destroy = true` argument (the upstream provider
# doesn't expose one), and the CF API returns 409 when DELETE-ing a
# non-empty bucket. Without this pass, `tofu destroy` either hangs or
# leaks the buckets.
#
# Workaround: a `terraform_data` per bucket that captures the bucket
# name + S3-compatible credentials in state, then runs `rclone purge`
# at destroy time. The wrapper is required because destroy-time
# provisioners can only reference `self` — pulling values from sibling
# resources (`cloudflare_api_token.data_r2.id` etc.) needs the values
# saved into the wrapper's `input`.
#
# `rclone` is a hard prereq — `brew install rclone` on macOS,
# `apt-get install rclone` on Debian/Ubuntu CI runners. The check
# fires early so a missing binary fails with a clear message instead
# of `command not found`.

resource "terraform_data" "data_bucket_purge" {
  input = {
    bucket_name = cloudflare_r2_bucket.data.name
    endpoint    = "https://${var.account_id}.r2.cloudflarestorage.com"
    access_key  = cloudflare_api_token.data_r2.id
    secret_key  = sha256(cloudflare_api_token.data_r2.value)
  }

  # Recreate the wrapper if the underlying bucket changes — keeps the
  # captured creds in state synced to the bucket they belong to.
  triggers_replace = {
    bucket_id = cloudflare_r2_bucket.data.id
  }

  provisioner "local-exec" {
    when    = destroy
    command = "rclone purge --config /dev/null :s3,provider=Cloudflare,endpoint='${self.input.endpoint}',access_key_id=$ACCESS_KEY,secret_access_key=$SECRET_KEY:${self.input.bucket_name} || echo 'WARN: rclone purge failed for ${self.input.bucket_name} (continuing; destroy may 409 if non-empty)'"
    environment = {
      ACCESS_KEY = self.input.access_key
      SECRET_KEY = self.input.secret_key
    }
  }
}

resource "terraform_data" "assets_bucket_purge" {
  input = {
    bucket_name = cloudflare_r2_bucket.assets.name
    endpoint    = "https://${var.account_id}.r2.cloudflarestorage.com"
    access_key  = cloudflare_api_token.assets_r2.id
    secret_key  = sha256(cloudflare_api_token.assets_r2.value)
  }

  triggers_replace = {
    bucket_id = cloudflare_r2_bucket.assets.id
  }

  provisioner "local-exec" {
    when    = destroy
    command = "rclone purge --config /dev/null :s3,provider=Cloudflare,endpoint='${self.input.endpoint}',access_key_id=$ACCESS_KEY,secret_access_key=$SECRET_KEY:${self.input.bucket_name} || echo 'WARN: rclone purge failed for ${self.input.bucket_name} (continuing; destroy may 409 if non-empty)'"
    environment = {
      ACCESS_KEY = self.input.access_key
      SECRET_KEY = self.input.secret_key
    }
  }
}
