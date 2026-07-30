#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const FRONTEND_PORT = 3000;
const BACKEND_PORT = 4000;

function fail(message) {
  console.error(`\n[config-project-fullstack] ${message}`);
  process.exit(1);
}

function log(message) {
  console.log(`[config-project-fullstack] ${message}`);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    projectName: null,
    namespace: null,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--namespace" || arg === "--scope") {
      options.namespace = args[i + 1];
      if (!options.namespace || options.namespace.startsWith("-")) {
        fail(`Informe um valor para ${arg}. Exemplo: ${arg} '@minha-org'`);
      }
      i += 1;
      continue;
    }

    if (arg.startsWith("--namespace=")) {
      options.namespace = arg.slice("--namespace=".length);
      if (!options.namespace) {
        fail("Informe um valor para --namespace. Exemplo: --namespace='@minha-org'");
      }
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    if (arg.startsWith("-")) {
      fail(`Opcao desconhecida: ${arg}`);
    }

    if (options.projectName) {
      fail("Informe apenas um nome de projeto.");
    }

    options.projectName = arg;
  }

  options.projectName = options.projectName || path.basename(process.cwd());
  validateProjectName(options.projectName);

  if (options.namespace) {
    validateNamespace(options.namespace);
  }

  return options;
}

function printHelp() {
  console.log(`
Uso:
  node setup-fullstack-project.js [nome-do-package-raiz] [--namespace @minha-org]

Exemplos:
  node setup-fullstack-project.js --namespace '@autobras'
  node setup-fullstack-project.js projeto-exemplo --namespace '@autobras'
`);
}

function validateProjectName(projectName) {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(projectName)) {
    fail("Nome do projeto invalido. Use letras minusculas, numeros, ponto, underscore ou hifen.");
  }

  if (projectName === "." || projectName === ".." || projectName.includes("/") || projectName.includes("\\")) {
    fail("Nome do projeto deve ser apenas um nome de pasta, sem separadores de caminho.");
  }
}

function validateNamespace(namespace) {
  if (!/^@[a-z0-9][a-z0-9._-]*$/.test(namespace)) {
    fail("Namespace invalido. Use o formato @minha-org com letras minusculas, numeros, ponto, underscore ou hifen.");
  }
}

function ensureCommand(command) {
  const checker = process.platform === "win32" ? "where" : "command";
  const args = process.platform === "win32" ? [command] : ["-v", command];
  const result = spawnSync(checker, args, { stdio: "ignore", shell: process.platform !== "win32" });

  if (result.status !== 0) {
    fail(`Comando obrigatorio nao encontrado: ${command}`);
  }
}

function ensureSafeWorkspace(baseDir) {
  const resolvedBase = fs.realpathSync(baseDir);
  const root = path.parse(resolvedBase).root;
  const home = process.env.USERPROFILE || process.env.HOME;

  if (resolvedBase === root || (home && path.resolve(home) === resolvedBase)) {
    fail("Recusando criar projeto em um diretorio sensivel.");
  }

  const allowedExisting = new Set([".agents", ".git"]);
  const blockingEntries = fs
    .readdirSync(resolvedBase)
    .filter((entry) => !allowedExisting.has(entry) && !entry.startsWith(".config-project-fullstack-tmp-"));

  if (blockingEntries.length > 0) {
    fail(`A pasta atual precisa estar vazia ou conter somente .agents. Entradas encontradas: ${blockingEntries.join(", ")}`);
  }

  return resolvedBase;
}

function createTempProjectDir(baseDir) {
  const tempName = `.config-project-fullstack-tmp-${Date.now()}`;
  const tempDir = path.join(baseDir, tempName);

  if (fs.existsSync(tempDir)) {
    fail(`Diretorio temporario ja existe: ${tempDir}`);
  }

  return { tempName, tempDir };
}

function run(command, args, cwd) {
  log(`Executando: ${command} ${args.join(" ")}`);
  const executable = process.platform === "win32" && (command === "npm" || command === "npx") ? "cmd.exe" : command;
  const executableArgs =
    process.platform === "win32" && (command === "npm" || command === "npx")
      ? ["/d", "/c", [`${command}.cmd`, ...args].join(" ")]
      : args;
  const result = spawnSync(executable, executableArgs, {
    cwd,
    stdio: "inherit",
    shell: false,
    env: {
      ...process.env,
      npm_config_yes: "true",
      CI: "1",
    },
  });

  if (result.error) {
    fail(`Falha ao executar ${command}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    fail(`Comando terminou com codigo ${result.status}: ${command} ${args.join(" ")}`);
  }
}

function removeDirectoryContents(directory) {
  if (!fs.existsSync(directory)) {
    fail(`Diretorio esperado nao existe: ${directory}`);
  }

  for (const entry of fs.readdirSync(directory)) {
    fs.rmSync(path.join(directory, entry), { recursive: true, force: true });
  }
}

function removeGeneratedTurboApps(appsDir) {
  for (const appName of ["docs", "web"]) {
    const appPath = path.join(appsDir, appName);
    if (fs.existsSync(appPath)) {
      fs.rmSync(appPath, { recursive: true, force: true });
    }
  }
}

function moveProjectIntoWorkspace(sourceDir, workspaceDir) {
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(workspaceDir, entry.name);

    if (fs.existsSync(destinationPath)) {
      fail(`Nao foi possivel mover o projeto: destino ja existe (${destinationPath}).`);
    }

    fs.renameSync(sourcePath, destinationPath);
  }

  fs.rmSync(sourceDir, { recursive: true, force: true });
}

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content.replace(/\n/g, "\r\n"), "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function configureBackend(projectDir) {
  const backendDir = path.join(projectDir, "apps", "backend");
  const appModulePath = path.join(backendDir, "src", "app.module.ts");
  const mainPath = path.join(backendDir, "src", "main.ts");
  const packagePath = path.join(backendDir, "package.json");

  assertFile(appModulePath);
  assertFile(mainPath);
  assertFile(packagePath);

  writeText(appModulePath, `import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
`);

  writeText(mainPath, `import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  await app.listen(process.env.PORT ?? ${BACKEND_PORT});
}
bootstrap();
`);

  const pkg = readJson(packagePath);
  pkg.scripts = pkg.scripts || {};
  pkg.scripts.dev = "nest start --watch";
  writeJson(packagePath, pkg);
}

function configureEnvFiles(projectDir) {
  writeText(
    path.join(projectDir, "apps", "frontend", ".env.example"),
    `NEXT_PUBLIC_API_URL=http://localhost:${BACKEND_PORT}
`,
  );
  writeText(
    path.join(projectDir, "apps", "frontend", ".env"),
    `NEXT_PUBLIC_API_URL=http://localhost:${BACKEND_PORT}
`,
  );
  writeText(
    path.join(projectDir, "apps", "backend", ".env.example"),
    `PORT=${BACKEND_PORT}
`,
  );
  writeText(
    path.join(projectDir, "apps", "backend", ".env"),
    `PORT=${BACKEND_PORT}
`,
  );
}

function assertFile(filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    fail(`Arquivo esperado nao encontrado: ${filePath}`);
  }
}

function findPackageJsonFiles(projectDir) {
  const results = [];

  function walk(currentDir) {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".next" || entry.name === "dist") {
        continue;
      }

      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (entry.isFile() && entry.name === "package.json") {
        results.push(fullPath);
      }
    }
  }

  walk(projectDir);
  return results.sort();
}

function packageNameFor(projectDir, packagePath, namespace, projectName) {
  const packageDir = path.dirname(packagePath);
  const relativeDir = path.relative(projectDir, packageDir).replace(/\\/g, "/");

  if (relativeDir === "") {
    return `${namespace}/${projectName}`;
  }

  if (relativeDir === "apps/frontend") {
    return `${namespace}/frontend`;
  }

  if (relativeDir === "apps/backend") {
    return `${namespace}/backend`;
  }

  const basename = path.basename(packageDir);
  return `${namespace}/${basename}`;
}

function applyNamespace(projectDir, projectName, namespace) {
  if (!namespace) {
    return;
  }

  log(`Aplicando namespace ${namespace} aos packages locais`);

  const packageFiles = findPackageJsonFiles(projectDir);
  const packageNameMap = new Map();

  for (const packageFile of packageFiles) {
    const pkg = readJson(packageFile);
    if (pkg.name) {
      packageNameMap.set(pkg.name, packageNameFor(projectDir, packageFile, namespace, projectName));
    }
  }

  for (const packageFile of packageFiles) {
    const pkg = readJson(packageFile);
    const nextName = packageNameFor(projectDir, packageFile, namespace, projectName);
    pkg.name = nextName;

    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      if (!pkg[field]) {
        continue;
      }

      for (const [oldName, newName] of packageNameMap.entries()) {
        if (Object.prototype.hasOwnProperty.call(pkg[field], oldName)) {
          pkg[field][newName] = pkg[field][oldName];
          delete pkg[field][oldName];
        }
      }
    }

    writeJson(packageFile, pkg);
  }
}

function validateFinalProject(projectDir, namespace) {
  const requiredFiles = [
    "package.json",
    "apps/frontend/package.json",
    "apps/frontend/.env",
    "apps/frontend/.env.example",
    "apps/backend/package.json",
    "apps/backend/.env",
    "apps/backend/.env.example",
    "apps/backend/src/app.module.ts",
    "apps/backend/src/main.ts",
  ];

  for (const file of requiredFiles) {
    assertFile(path.join(projectDir, file));
  }

  const appModule = fs.readFileSync(path.join(projectDir, "apps/backend/src/app.module.ts"), "utf8");
  const main = fs.readFileSync(path.join(projectDir, "apps/backend/src/main.ts"), "utf8");
  const backendPkg = readJson(path.join(projectDir, "apps/backend/package.json"));
  const frontendEnv = fs.readFileSync(path.join(projectDir, "apps/frontend/.env"), "utf8");
  const backendEnv = fs.readFileSync(path.join(projectDir, "apps/backend/.env"), "utf8");

  for (const generatedApp of ["docs", "web"]) {
    if (fs.existsSync(path.join(projectDir, "apps", generatedApp))) {
      fail(`App gerado pelo Turbo nao foi removido: apps/${generatedApp}`);
    }
  }

  if (!appModule.includes("ConfigModule.forRoot") || !appModule.includes("isGlobal: true")) {
    fail("Backend nao foi configurado com ConfigModule global.");
  }

  if (!main.includes("app.enableCors()") || !main.includes(`process.env.PORT ?? ${BACKEND_PORT}`)) {
    fail("Backend main.ts nao habilitou CORS ou porta padrao correta.");
  }

  if (backendPkg.scripts?.dev !== "nest start --watch") {
    fail("Script dev do backend nao foi configurado.");
  }

  if (!frontendEnv.includes(`NEXT_PUBLIC_API_URL=http://localhost:${BACKEND_PORT}`)) {
    fail("Env do frontend nao aponta para a porta do backend.");
  }

  if (!backendEnv.includes(`PORT=${BACKEND_PORT}`)) {
    fail("Env do backend nao contem a porta correta.");
  }

  if (namespace) {
    for (const packageFile of findPackageJsonFiles(projectDir)) {
      const pkg = readJson(packageFile);
      if (pkg.name && !pkg.name.startsWith(`${namespace}/`)) {
        fail(`Package sem namespace aplicado: ${packageFile}`);
      }
    }
  }

  log(`Validacao concluida. Frontend: http://localhost:${FRONTEND_PORT} | Backend: http://localhost:${BACKEND_PORT}`);
}

function main() {
  const options = parseArgs(process.argv);
  const cwd = process.cwd();
  const projectDir = ensureSafeWorkspace(cwd);
  const tempProject = createTempProjectDir(projectDir);

  ensureCommand("node");
  ensureCommand("npm");
  ensureCommand("npx");

  run("npx", ["--yes", "create-turbo@latest", tempProject.tempName, "-m", "npm"], projectDir);

  const tempAppsDir = path.join(tempProject.tempDir, "apps");
  removeDirectoryContents(tempAppsDir);

  run("npx", ["--yes", "create-next-app@latest", "frontend", "--yes", "--src-dir"], tempAppsDir);
  run("npx", ["--yes", "@nestjs/cli@latest", "new", "backend", "-g", "-p", "npm"], tempAppsDir);
  run("npm", ["install", "@nestjs/config"], path.join(tempAppsDir, "backend"));

  configureBackend(tempProject.tempDir);
  configureEnvFiles(tempProject.tempDir);
  removeGeneratedTurboApps(tempAppsDir);
  moveProjectIntoWorkspace(tempProject.tempDir, projectDir);
  removeGeneratedTurboApps(path.join(projectDir, "apps"));
  applyNamespace(projectDir, options.projectName, options.namespace);
  validateFinalProject(projectDir, options.namespace);

  log("Projeto fullstack criado com sucesso.");
}

main();
