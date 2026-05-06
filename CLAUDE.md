# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

"Math Hero Academy" (数学超人学院) - a multiplication table learning website for Chinese elementary school students with a superhero theme. Pure HTML/CSS/JS, no build tools, no dependencies.

## How to Rcun

Open `index.html` directly in a browser. No server, build step, or package manager required.

## Architecture

**Single-page application** with section-based routing. All "pages" are `<section>` elements in `index.html` with IDs following `page-{name}` pattern. Navigation toggles the `active` CSS class via `App.showPage()` in `app.js`.

**Module system**: Global object literals (no ES modules). Script load order matters:

```
storage.js → hero.js → table.js → learn.js → games.js → progress.js → app.js
```

**Data persistence**: All state in localStorage via `Storage` module. Keys prefixed with `mathHero_`. Mastery tracking is bidirectional (`3x4` and `4x3` updated simultaneously).

## Key Modules

| Module       | Purpose                                                                                               |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| `Storage`  | localStorage CRUD, streak/mastery/badge/level helpers                                                 |
| `Hero`     | CSS-drawn superhero character, state machine (idle/flying/celebrating/attacking/hurt), visual effects |
| `Table`    | 9×9 multiplication grid, filtering, detail modal, Chinese number mapping                             |
| `Learn`    | 6-step animated teaching sequence (play/pause/step controls)                                          |
| `Games`    | Orchestrator +`BalloonGame`/`StarGame`/`CipherGame` sub-objects                                 |
| `Progress` | Badge definitions with check functions, achievements page rendering                                   |
| `App`      | Entry point, navigation wiring, star background, notification utility                                 |

## Game Lifecycle Pattern

Each game sub-object implements `init()` and `cleanup()`. `cleanup()` must cancel animation frames and intervals. Games call `Games.onCorrect()`/`Games.onWrong()` which update Storage and trigger `Progress.checkAchievements()`.

## CSS Theming

Custom properties in `:root` (style.css):

- `--hero-blue: #1E90FF`, `--hero-red: #FF4444`, `--energy-gold: #FFD700`, `--energy-green: #00FF88`
- Glassmorphism theme with `--glass-bg` and `--glass-border`

Superhero character is entirely CSS-drawn (no image assets). Hero appearance upgrades based on mastery: 30% = equipped, 60% = silver cape, 90% = gold cape + crown.

## Conventions

- Navigation uses `data-page` attributes on buttons
- No URL-based routing; refresh returns to home
- Dynamic `<style>` injection in `progress.js` and `table.js`
- Chinese multiplication phrases via `Table.getChinesePhrase()` (e.g., "三四十二")
- Level system: exp needed = level × 100
- Media query at 768px for responsive layouts
