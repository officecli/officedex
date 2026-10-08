# Agent Office English Article

English publication package for the article originally published on WeChat as
“别再叫 AI Office 了：下一代办公软件，是 Agent Office”.

## Contents

- `article.md`: publication-ready English adaptation
- `images/source/`: original Chinese diagrams
- `images/en/`: English-localized diagrams
- `render_english_diagrams.py`: deterministic renderer for the English labels

The English version is an editorial adaptation rather than a literal translation.
It preserves the original argument while using a more natural structure and voice
for an international product and technology audience.

The English diagrams preserve the original artwork and add publication-safe labels
with deterministic typography. Rebuild them with:

```bash
python3 render_english_diagrams.py
```
