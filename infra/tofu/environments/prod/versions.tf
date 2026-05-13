terraform {
  required_version = ">= 1.6.0"
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.0"
    }
    ansible = {
      source  = "ansible/ansible"
      version = "~> 1.3"
    }
  }
}
