variable "vm_name" {
  type    = string
  default = "meta-menu-server"
}

variable "deploy_user" {
  type    = string
  default = "deploy"
}

variable "ssh_public_key_path" {
  type    = string
  default = "~/.ssh/id_ed25519.pub"
}

variable "ssh_port" {
  type    = number
  default = 2222
}

variable "app_port" {
  type    = number
  default = 8080
}

variable "memory_gb" {
  type    = number
  default = 2
}
