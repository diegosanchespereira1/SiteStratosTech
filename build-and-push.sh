#!/bin/bash

# Script para build e push da imagem Docker
# Uso: ./build-and-push.sh

set -e

# Cores para output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}🔨 Build da Imagem SiteStratosTech${NC}"

# Configurações - ALTERE AQUI
DOCKERHUB_USER="${DOCKERHUB_USER:-polygonuser}"
IMAGE_NAME="sitestratostech"
VITE_SUPABASE_URL="${VITE_SUPABASE_URL:-https://supabase.polygonconsulting.com.br}"
VITE_SUPABASE_PUBLISHABLE_KEY="${VITE_SUPABASE_PUBLISHABLE_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.ewogICJyb2xlIjogImFub24iLAogICJpc3MiOiAic3VwYWJhc2UiLAogICJpYXQiOiAxNzE1MDUwODAwLAogICJleHAiOiAxODcyODE3MjAwCn0.vJ0x-0zcYQYSxjUTf4WllMLSIh_QEP0a76EPT4urjhQ}"

# Verificar se as variáveis estão configuradas
if [ "$VITE_SUPABASE_PUBLISHABLE_KEY" == "sua_chave_aqui" ]; then
  echo -e "${RED}❌ Erro: Configure VITE_SUPABASE_PUBLISHABLE_KEY${NC}"
  echo "   Exporte a variável: export VITE_SUPABASE_PUBLISHABLE_KEY=sua_chave"
  exit 1
fi

if [ "$DOCKERHUB_USER" == "seu-usuario" ]; then
  echo -e "${YELLOW}⚠️  Usando 'seu-usuario' como Docker Hub user${NC}"
  echo "   Configure: export DOCKERHUB_USER=seu-usuario-real"
  read -p "   Continuar mesmo assim? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# Build
echo -e "${GREEN}📦 Fazendo build da imagem...${NC}"
docker build \
  --build-arg VITE_SUPABASE_URL="$VITE_SUPABASE_URL" \
  --build-arg VITE_SUPABASE_PUBLISHABLE_KEY="$VITE_SUPABASE_PUBLISHABLE_KEY" \
  -t $DOCKERHUB_USER/$IMAGE_NAME:developer .

if [ $? -eq 0 ]; then
  echo -e "${GREEN}✅ Build concluído com sucesso!${NC}"
else
  echo -e "${RED}❌ Erro no build${NC}"
  exit 1
fi

# Perguntar se deseja fazer push
read -p "Deseja fazer push para Docker Hub? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  echo -e "${GREEN}🚀 Fazendo push para Docker Hub...${NC}"
  
  # Verificar se está logado
  if ! docker info | grep -q "Username"; then
    echo -e "${YELLOW}⚠️  Não está logado no Docker Hub${NC}"
    echo "   Executando: docker login"
    docker login
  fi
  
  docker push $DOCKERHUB_USER/$IMAGE_NAME:developer
  
  if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Push concluído com sucesso!${NC}"
    echo ""
    echo "📝 Para usar no Portainer, a imagem já está configurada no docker-compose.swarm.yml:"
    echo "   image: $DOCKERHUB_USER/$IMAGE_NAME:developer"
  else
    echo -e "${RED}❌ Erro no push${NC}"
    exit 1
  fi
else
  echo -e "${YELLOW}ℹ️  Imagem buildada localmente: $DOCKERHUB_USER/$IMAGE_NAME:developer${NC}"
  echo "   Para usar no servidor, faça push ou use build direto no servidor"
fi

echo ""
echo -e "${GREEN}✨ Concluído!${NC}"