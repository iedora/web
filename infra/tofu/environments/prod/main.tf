provider "hcloud" {
  token = var.hcloud_token
}

provider "ansible" {}

locals {
  shared          = yamldecode(file("${path.module}/../../../shared/vars.yml"))
  ssh_public_key  = trimspace(file(pathexpand(var.ssh_public_key_path)))
  ssh_private_key = file(pathexpand(var.ssh_private_key_path))
}

resource "hcloud_ssh_key" "deploy" {
  name       = "${local.shared.vm_name}-deploy"
  public_key = local.ssh_public_key
}

resource "hcloud_server" "server" {
  name        = local.shared.vm_name
  image       = "ubuntu-24.04"
  server_type = var.server_type
  location    = var.location
  ssh_keys    = [hcloud_ssh_key.deploy.id]

  # cloud-init mínimo: só cria o utilizador deploy com a chave SSH.
  # Tudo o resto (pacotes, Docker, UFW) vem do Ansible — única fonte de verdade.
  user_data = <<-EOT
    #cloud-config
    users:
      - name: ${local.shared.deploy_user}
        groups: [sudo]
        shell: /bin/bash
        sudo: ALL=(ALL) NOPASSWD:ALL
        lock_passwd: true
        ssh_authorized_keys:
          - ${local.ssh_public_key}
  EOT
}

resource "ansible_host" "server" {
  name   = local.shared.vm_name
  groups = ["servers", "metal", "prod"]

  variables = {
    ansible_host                 = hcloud_server.server.ipv4_address
    ansible_port                 = "22"
    ansible_user                 = local.shared.deploy_user
    ansible_ssh_private_key_file = var.ssh_private_key_path
    ansible_ssh_common_args      = "-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"
  }

  depends_on = [hcloud_server.server]
}

# Espera que o SSH esteja disponível antes do Ansible tentar conectar
resource "null_resource" "wait_for_ssh" {
  depends_on = [hcloud_server.server]

  connection {
    type        = "ssh"
    user        = local.shared.deploy_user
    private_key = local.ssh_private_key
    host        = hcloud_server.server.ipv4_address
    timeout     = "120s"
  }

  provisioner "remote-exec" {
    inline = ["echo 'SSH ready'"]
  }
}
