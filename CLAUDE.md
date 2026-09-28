# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This repo holds tools for Chinese elementary students:

- **Root (`index.html` + `js/`, `css/`)** — "动手建造区", the drag-and-drop multiplication builder described below. Pure static, no backend.
- **`hanzi-score/`** — "田字格小老师", a FastAPI service that scores a first-grader's handwriting from a 田字格 photo (uploads image → multimodal LLM → score + improvement points, below 60 suggests a rewrite). The only part of this repo with a backend; see `hanzi-score/README.md`.

## Project Overview

"动手建造区" (Hands-on Building Area) - an interactive multiplication table learning tool for Chinese elementary school students. Users drag numbers into "bases" to discover multiplication facts through addition. Pure HTML/CSS/JS, no build tools, no dependencies.

## How to Run

Open `index.html` directly in a browser. No server, build step, or package manager required.

## Architecture

**Single-page application** with one active section: `page-builder`. All logic lives in a global `Table` object.

**Module system**: Global object literals (no ES modules). Script load order:

```
storage.js → table.js → app.js
```

**Data persistence**: Minimal localStorage via `Storage` module. Only stores tutorial completion state (`mathHero_tutorialDone`).

## Key Modules

| Module     | Purpose |
|------------|---------|
| `Storage`  | localStorage get/set/remove wrapper |
| `Table`    | All builder logic: drag-and-drop, base management, result calculation, Chinese phrase generation, challenge mode, commutative property, celebration effects |
| `App`      | Entry point, star background, notification utility |

## Builder Features

- **Drag numbers (1-9)** from shelf into bases to build addition expressions
- **Auto-detect multiplication**: when 2+ same numbers are placed, shows multiplication form and Chinese phrase
- **Challenge mode**: pick difficulty (easy/medium/hard), get a target number to build
- **Commutative property**: "转一转" button swaps factors
- **Add/remove bases**: 1-9 bases, auto-layout grid
- **Celebration**: fireworks + flying hero image + encouragement modal on milestones

## CSS Theming

Custom properties in `:root` (style.css):

- `--hero-blue: #1E90FF`, `--hero-red: #FF4444`, `--energy-gold: #FFD700`, `--energy-green: #00FF88`
- Glassmorphism theme with `--glass-bg` and `--glass-border`

## Conventions

- No URL-based routing; page is always the builder
- Chinese multiplication phrases via `Table.getChinesePhrase()` (e.g., "三四十二")
- Media query at 768px for responsive layouts
