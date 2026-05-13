provider "docker" {}
provider "ansible" {}

locals {
  shared          = yamldecode(file("${path.module}/../../../shared/vars.yml"))
  ssh_public_key  = trimspace(file(pathexpand(var.ssh_public_key_path)))
  docker_context  = "${path.module}/../../../docker"
}

resource "docker_image" "server" {
  name         = "meta-menu-server-base:latest"
  keep_locally = true

  build {
    context    = local.docker_context
    dockerfile = "Dockerfile.server"
    build_args = {
      DEPLOY_USER = local.shared.deploy_user
    }
  }
}

resource "docker_container" "server" {
  name    = local.shared.vm_name
  image   = docker_image.server.image_id
  restart = "unless-stopped"

  # Privileged necessário para Docker-in-Docker (Kamal corre dockerd dentro)
  privileged = true

  ports {
    internal = 22
    external = var.ssh_port
  }

  # kamal-proxy (80 dentro do container) → 8080 no host
  ports {
    internal = 80
    external = var.app_port
  }

  memory = var.memory_gb * 1024

  upload {
    content = "${local.ssh_public_key}\n"
    file    = "/home/${local.shared.deploy_user}/.ssh/authorized_keys"
  }
}

# Declara o host para o inventory dinâmico do Ansible (collection cloud.terraform)
resource "ansible_host" "server" {
  name   = local.shared.vm_name
  groups = ["servers", "containers", "local"]

  variables = {
    ansible_host                 = "localhost"
    ansible_port                 = tostring(var.ssh_port)
    ansible_user                 = local.shared.deploy_user
    ansible_ssh_private_key_file = "~/.ssh/id_ed25519"
    ansible_ssh_common_args      = "-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"
  }

  depends_on = [docker_container.server]
}
