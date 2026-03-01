#!/usr/bin/env bash
# Build (e opcionalmente push) da imagem StratosBot para linux/amd64.
# Use este script ao fazer deploy a partir de um Mac para evitar imagem ARM (pending no Swarm).
set -e
IMAGE="${STRATOSBOT_IMAGE:-polygonuser/stratosbot:latest}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
echo "Building for linux/amd64: $IMAGE"
docker build --platform linux/amd64 -t "$IMAGE" .
if [[ "${1:-}" == "push" ]]; then
  echo "Pushing $IMAGE"
  docker push "$IMAGE"
  echo "Done. Atualize o stack no Portainer/Swarm para puxar a nova imagem."
else
  echo "Para enviar ao registry, rode: $0 push"
fi
