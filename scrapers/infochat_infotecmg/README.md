## Scraper – InfoChat InfoTec MG

Este pequeno projeto faz o scraping da página principal do `infochat.infotecmg.net` e salva:

- HTML bruto da página
- Conteúdo estruturado (títulos, textos, listas, planos, depoimentos) em JSON
- Uma versão em Markdown para facilitar a edição e reaproveitamento no seu próprio site

### Requisitos

Instale as dependências em um ambiente virtual de sua preferência:

```bash
cd scrapers/infochat_infotecmg
pip install -r requirements.txt
```

### Uso

```bash
cd scrapers/infochat_infotecmg
python scrape_infochat.py \
  --url https://infochat.infotecmg.net \
  --output-dir ./output
```

Parâmetros:

- `--url` (opcional): URL base a ser coletada (padrão: `https://infochat.infotecmg.net`)
- `--output-dir` (opcional): pasta onde os arquivos serão salvos (padrão: `./output`)

### Saída gerada

Na pasta de saída (por padrão `scrapers/infochat_infotecmg/output/`) serão criados:

- `raw.html` – HTML completo retornado pela página
- `content.json` – estrutura com seções principais do site
- `content.md` – versão em Markdown do conteúdo textual, para fácil edição

### Observações de uso responsável

- Este scraper foi feito para coletar **apenas a página pública principal**.
- Antes de usar o conteúdo em produção, adapte textos, branding e estrutura para a sua própria identidade visual e posicionamento.

