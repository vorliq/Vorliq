Vorliq Docker Setup
===================

Docker is an alternative way to run the Vorliq stack when you do not want to install Python, Node.js, and nginx directly on the host. On Ubuntu, install Docker from the official Docker repository and make sure the Docker Compose plugin is available before starting the Vorliq services.

On a fresh Ubuntu server, update the package index, install Docker, and enable the Docker service. The exact commands may change over time, so production operators should compare them with the current Docker documentation before running them on a public server.

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
```

After Docker is installed, clone Vorliq and start the complete stack with Docker Compose from the project root. The blockchain service runs on port 5001, the backend API runs on port 5000, and the frontend is served on port 3000. The blockchain data is stored in the `vorliq-data` Docker volume so it survives container restarts.

```bash
git clone https://github.com/vorliq/Vorliq.git
cd Vorliq
docker compose up --build -d
```

When the containers are running, open `http://SERVER_IP:3000` in a browser. To stop the stack, run `docker compose down`. To remove the saved blockchain data as well, remove the `vorliq-data` volume only when you intentionally want to delete the node state.
