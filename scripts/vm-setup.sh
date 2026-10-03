#!/usr/bin/env bash
# One-time setup for a fresh Ubuntu 22.04/24.04 VM (Oracle Cloud Always Free or any other).
# Run as the normal sudo user:   bash scripts/vm-setup.sh
set -euo pipefail

echo "==> Updating the system and installing basics"
sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl git ufw fail2ban unattended-upgrades iptables-persistent

echo "==> Installing Docker"
if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sudo sh; fi
sudo usermod -aG docker "$USER"

echo "==> Automatic security updates"
sudo dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> Swap (2 GB), so image processing spikes do not kill containers"
if ! swapon --show | grep -q swapfile; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo "==> Firewall: SSH, HTTP, HTTPS only"
# Oracle's Ubuntu images ship iptables rules that block 80/443 even after you open them in the cloud console.
for p in 80 443; do
  sudo iptables -C INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 6 -p tcp --dport "$p" -j ACCEPT
done
sudo iptables -C INPUT -p udp --dport 443 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 6 -p udp --dport 443 -j ACCEPT
sudo netfilter-persistent save
sudo ufw allow OpenSSH >/dev/null; sudo ufw allow 80/tcp >/dev/null; sudo ufw allow 443 >/dev/null
sudo ufw --force enable

echo "==> SSH: keys only, no root login"
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/; s/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sudo systemctl reload ssh || sudo systemctl reload sshd

sudo systemctl enable --now fail2ban

echo
echo "Done. Log out and back in once (so the docker group applies), then:"
echo "  cd ~/thoughts && bash scripts/gen-env.sh your-domain.com you@private-address.com"
