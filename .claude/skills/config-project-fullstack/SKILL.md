---
name: config-project-fullstack
description: Create a deterministic fullstack monorepo in the current directory with Turbo, a Next.js frontend, a NestJS backend, CORS, @nestjs/config, environment files, and optional package namespace rewriting. Use when the user asks to bootstrap or configure a new Turbo/Next/Nest project with frontend on port 3000 and backend on port 4000, especially in a root folder that only contains .agents.
---

# Config Project Fullstack

Use `scripts/setup-fullstack-project.js` to create the project. The script owns the deterministic workflow and performs safety checks before writing files.

## Usage

Run from the project root directory. The current directory must be empty or contain only `.agents`; the script creates the monorepo directly in this directory and preserves `.agents`.

```bash
node .agents/skills/config-project-fullstack/scripts/setup-fullstack-project.js
```

With a namespace:

```bash
node .agents/skills/config-project-fullstack/scripts/setup-fullstack-project.js --namespace '@minha-org'
```

## Behavior

The script:

- Uses the current folder name as the root package name unless an optional package name is provided.
- Runs `npx --yes create-turbo@latest <temp-project> -m npm` in a temporary folder.
- Moves the generated monorepo contents into the current directory while preserving `.agents`.
- Removes generated Turbo apps from `apps/`, including `apps/docs` and `apps/web`.
- Creates `apps/frontend` with `create-next-app --yes --src-dir`.
- Creates `apps/backend` with Nest CLI, package manager `npm`, and no git repository.
- Installs `@nestjs/config` in the backend.
- Rewrites `apps/backend/src/app.module.ts` to load `ConfigModule.forRoot({ isGlobal: true })`.
- Rewrites `apps/backend/src/main.ts` to enable CORS and listen on `process.env.PORT ?? 4000`.
- Adds the backend `dev` script as `nest start --watch`.
- Creates `apps/frontend/.env.example` and `.env` with `NEXT_PUBLIC_API_URL=http://localhost:4000`.
- Creates `apps/backend/.env.example` and `.env` with `PORT=4000`.
- If `--namespace @scope` is provided, rewrites package names in root, frontend, backend, and other local packages to use that namespace.
- Validates that `apps/docs` and `apps/web` do not exist in the final project.

Prefer this script over manually repeating the commands. It fails fast if the current directory already contains files other than `.agents`, required commands are missing, or expected generated files are absent.
