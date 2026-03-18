import argparse
import json
import os
from dataclasses import asdict, dataclass, field
from typing import List, Optional

import requests
from bs4 import BeautifulSoup, Tag


@dataclass
class PricingPlan:
    title: str
    subtitle: Optional[str] = None
    price: Optional[str] = None
    description_items: List[str] = field(default_factory=list)


@dataclass
class Testimonial:
    name: str
    role_location: Optional[str] = None
    text: Optional[str] = None


@dataclass
class PageContent:
    hero_title: Optional[str] = None
    hero_subtitle: Optional[str] = None
    hero_ctas: List[str] = field(default_factory=list)

    features: List[str] = field(default_factory=list)
    integrations: List[str] = field(default_factory=list)
    plans_intro: Optional[str] = None
    pricing_plans: List[PricingPlan] = field(default_factory=list)
    testimonials: List[Testimonial] = field(default_factory=list)
    contact_info: List[str] = field(default_factory=list)
    footer_notes: List[str] = field(default_factory=list)


def fetch_html(url: str) -> str:
    resp = requests.get(url, timeout=20)
    resp.raise_for_status()
    return resp.text


def clean_text(text: str) -> str:
    return " ".join(text.split()).strip()


def extract_text_list(container: Optional[Tag]) -> List[str]:
    if not container:
        return []
    texts: List[str] = []
    for el in container.find_all(["p", "li"], recursive=True):
        t = clean_text(el.get_text(separator=" ", strip=True))
        if t:
            texts.append(t)
    return texts


def parse_page(html: str) -> PageContent:
    soup = BeautifulSoup(html, "html.parser")
    content = PageContent()

    # Hero (busca o primeiro h1 e alguns textos próximos)
    h1 = soup.find("h1")
    if h1:
        content.hero_title = clean_text(h1.get_text())
        # tenta pegar subtítulo (próximo parágrafo ou h2)
        next_text = h1.find_next(["p", "h2"])
        if next_text:
            content.hero_subtitle = clean_text(next_text.get_text())
        # CTAs (links/botões próximos ao h1)
        for btn in h1.find_all_next(["a", "button"], limit=6):
            btn_text = clean_text(btn.get_text())
            if btn_text and btn_text not in content.hero_ctas:
                content.hero_ctas.append(btn_text)

    # Features gerais (seções com títulos h2/h3 e listas/parágrafos)
    for section_title in soup.find_all(["h2", "h3"]):
        title_text = clean_text(section_title.get_text())
        if not title_text:
            continue

        lower = title_text.lower()
        if "recurso" in lower or "atendimento" in lower or "plataforma" in lower:
            # seção de recursos
            features_container = section_title.find_next("section") or section_title.parent
            content.features.extend(extract_text_list(features_container))
        elif "integra" in lower:
            # seção de integrações
            integrations_container = section_title.find_next("section") or section_title.parent
            items = extract_text_list(integrations_container)
            # evita misturar textos gerais, foca em elementos de lista/strong
            if items:
                content.integrations.extend(items)
        elif "plano" in lower:
            content.plans_intro = title_text
        elif "dizem nossos clientes" in lower or "clientes" in lower:
            # testemunhos tratados mais abaixo
            continue

    # Planos de preço – heurística: blocos com preço e lista de benefícios
    plan_cards: List[PricingPlan] = []
    # procura por elementos que contenham "R$" (preço)
    for price_el in soup.find_all(string=lambda s: isinstance(s, str) and "R$" in s):
        parent = price_el.find_parent()
        if not parent:
            continue
        # sobe alguns níveis para pegar o bloco do plano
        card = parent
        for _ in range(3):
            if card.parent:
                card = card.parent

        # tenta título e subtítulo
        title_tag = None
        for t in card.find_all(["h3", "h4"], limit=1):
            title_tag = t
            break

        title = clean_text(title_tag.get_text()) if title_tag else ""
        price = clean_text(str(price_el))

        if not title or not price:
            continue

        desc_items = extract_text_list(card)
        plan = PricingPlan(title=title, subtitle=None, price=price, description_items=desc_items)
        # evita duplicados
        if not any(p.title == plan.title and p.price == plan.price for p in plan_cards):
            plan_cards.append(plan)

    content.pricing_plans = plan_cards

    # Depoimentos
    testimonials: List[Testimonial] = []
    # heurística: buscar blocos com aspas ou com nomes em tags fortes
    for quote in soup.find_all(["blockquote", "p"]):
        text = clean_text(quote.get_text())
        if not text or len(text) < 40:
            continue
        # tenta encontrar nome nas proximidades
        name_tag = None
        for sibling in quote.find_all_next(["strong", "h4", "h5"], limit=1):
            name_tag = sibling
            break
        if not name_tag:
            continue

        name = clean_text(name_tag.get_text())
        role_loc = None
        # texto da tag seguinte (por exemplo, "Comércio de Moda, São Paulo")
        small = name_tag.find_next(["p", "small"])
        if small and small is not quote:
            role_loc = clean_text(small.get_text())

        test = Testimonial(name=name, role_location=role_loc, text=text)
        if not any(t.name == test.name and t.text == test.text for t in testimonials):
            testimonials.append(test)

    content.testimonials = testimonials

    # Contato básico (e-mail, telefone, endereço)
    for label in ["E-mail", "Telefone", "Endereço"]:
        el = soup.find(string=lambda s, label=label: isinstance(s, str) and label in s)
        if el:
            block = el.find_parent()
            if block:
                text = clean_text(block.get_text())
                if text and text not in content.contact_info:
                    content.contact_info.append(text)

    # Rodapé
    footer = soup.find("footer")
    if footer:
        content.footer_notes = extract_text_list(footer)

    return content


def to_markdown(content: PageContent) -> str:
    lines: List[str] = []

    if content.hero_title:
        lines.append(f"# {content.hero_title}")
    if content.hero_subtitle:
        lines.append("")
        lines.append(content.hero_subtitle)

    if content.hero_ctas:
        lines.append("")
        lines.append("**CTAs principais:**")
        for cta in content.hero_ctas:
            lines.append(f"- {cta}")

    if content.features:
        lines.append("")
        lines.append("## Recursos / Benefícios")
        for f in content.features:
            lines.append(f"- {f}")

    if content.integrations:
        lines.append("")
        lines.append("## Integrações")
        for i in content.integrations:
            lines.append(f"- {i}")

    if content.pricing_plans:
        lines.append("")
        lines.append("## Planos")
        for plan in content.pricing_plans:
            lines.append(f"### {plan.title}")
            if plan.price:
                lines.append(f"- **Preço**: {plan.price}")
            for item in plan.description_items:
                lines.append(f"- {item}")
            lines.append("")

    if content.testimonials:
        lines.append("")
        lines.append("## Depoimentos")
        for t in content.testimonials:
            lines.append(f"**{t.name}**")
            if t.role_location:
                lines.append(f"*{t.role_location}*")
            if t.text:
                lines.append(f"> {t.text}")
            lines.append("")

    if content.contact_info:
        lines.append("")
        lines.append("## Contato")
        for c in content.contact_info:
            lines.append(f"- {c}")

    if content.footer_notes:
        lines.append("")
        lines.append("## Rodapé / Notas legais")
        for n in content.footer_notes:
            lines.append(f"- {n}")

    return "\n".join(lines).strip() + "\n"


def save_outputs(html: str, content: PageContent, output_dir: str) -> None:
    os.makedirs(output_dir, exist_ok=True)

    raw_path = os.path.join(output_dir, "raw.html")
    json_path = os.path.join(output_dir, "content.json")
    md_path = os.path.join(output_dir, "content.md")

    with open(raw_path, "w", encoding="utf-8") as f:
        f.write(html)

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(asdict(content), f, ensure_ascii=False, indent=2)

    with open(md_path, "w", encoding="utf-8") as f:
        f.write(to_markdown(content))


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Scraper simples da landing page do InfoChat InfoTec MG."
    )
    parser.add_argument(
        "--url",
        default="https://infochat.infotecmg.net",
        help="URL a ser coletada (padrão: https://infochat.infotecmg.net)",
    )
    parser.add_argument(
        "--output-dir",
        default="./output",
        help="Diretório de saída para salvar HTML, JSON e Markdown (padrão: ./output)",
    )

    args = parser.parse_args()

    print(f"Baixando página de {args.url} ...")
    html = fetch_html(args.url)
    print("Processando conteúdo...")
    content = parse_page(html)
    print(f"Salvando resultados em {args.output_dir} ...")
    save_outputs(html, content, args.output_dir)
    print("Concluído.")


if __name__ == "__main__":
    main()

