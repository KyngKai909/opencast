// Opencast on Railway: every service, database, volume and bucket, in one file.
//
//   railway config plan     (see what would change in the linked environment)
//   railway config apply    (change it)
//
// Secrets never live here: variables marked preserve() are set once in Railway (the dashboard or
// `railway variables --set`) and kept. docs/deploy.md lists every variable and who needs it.
import { bucket, defineRailway, github, postgres, preserve, project, redis, ref, service, volume } from "railway/iac";

const REPO = "KyngKai909/untitled-project";

export default defineRailway((ctx) => {
  const production = ctx.isEnvironment("production");
  // Staging builds the monorepo branch until it merges; production builds main.
  const source = github(REPO, { branch: production ? "main" : "monorepo" });
  const shared = ["packages/**", "package.json", "package-lock.json", "turbo.json", "tsconfig.base.json", "nixpacks.toml"];
  const build = (filter: string, watch: string[]) => ({ builder: "NIXPACKS" as const, buildCommand: `npx turbo run build --filter=${filter}...`, watchPatterns: [...watch, ...shared] });
  const restart = { restartPolicyType: "ON_FAILURE" as const, restartPolicyMaxRetries: 10 };
  const secret = () => preserve();

  const Postgres = postgres("Postgres", { region: "us-west2" });
  Postgres.networking = { privateNetworkEndpoint: "postgres" };
  const Redis = redis("Redis", { region: "us-west2" });
  Redis.deploy = {
    startCommand: '/bin/sh -c "rm -rf $RAILWAY_VOLUME_MOUNT_PATH/lost+found/ && exec docker-entrypoint.sh redis-server --requirepass $REDIS_PASSWORD --save 60 1 --dir $RAILWAY_VOLUME_MOUNT_PATH"'
  };
  Redis.networking = { privateNetworkEndpoint: "redis" };
  const alerts = { usage: { "80": {}, "95": {}, "100": {} } };
  const redisVolume = volume("redis-volume", { alerts, allowOnlineResize: true, region: "us-west2", sizeMB: 5_000 });
  const postgresVolume = volume("postgres-volume", { alerts, allowOnlineResize: true, region: "us-west2", sizeMB: 5_000 });
  // The worker's file cache: the next 48 hours of every station's log. Production wants 100 GB
  // (a Railway plan above Hobby, whose volumes stop at 5 GB); staging's library is small.
  const cacheGB = production ? 100 : 5;
  const workerCache = volume("worker-cache", { alerts, allowOnlineResize: true, region: "us-west2", sizeMB: cacheGB * 1_000 });
  // Object storage by content ID. Production uses Cloudflare R2 (its keys preserved below);
  // staging uses a Railway bucket, S3-compatible, so it runs without a Cloudflare account.
  const media = production ? null : bucket("media", { region: "sjc" });

  // Where files live, for the API and the worker only.
  const storage = !media
    ? { R2_ACCOUNT_ID: secret(), R2_ACCESS_KEY_ID: secret(), R2_SECRET_ACCESS_KEY: secret(), R2_BUCKET: secret(), R2_PUBLIC_BASE: secret() }
    : {
        R2_ENDPOINT: ref(media, "ENDPOINT"),
        R2_ACCESS_KEY_ID: ref(media, "ACCESS_KEY_ID"),
        R2_SECRET_ACCESS_KEY: ref(media, "SECRET_ACCESS_KEY"),
        R2_BUCKET: ref(media, "BUCKET"),
        // Railway buckets use virtual-host URLs, and have no storage classes.
        S3_FORCE_PATH_STYLE: "false",
        S3_STORAGE_CLASSES: "false"
      };
  const origin = (name: string) => `https://\${{${name}.RAILWAY_PUBLIC_DOMAIN}}`;
  const common = {
    NODE_ENV: "production",
    DATABASE_URL: Postgres.env.DATABASE_URL,
    REDIS_URL: Redis.env.REDIS_URL,
    APP_ORIGIN: origin("viewer"),
    PAYMENTS_PROVIDER: production ? secret() : "fake",
    STRIPE_SECRET_KEY: secret(),
    STRIPE_WEBHOOK_SECRET: secret(),
    PRIVY_APP_ID: secret(),
    PRIVY_VERIFICATION_KEY: secret(),
    PRIVY_APP_SECRET: secret(),
    // Clear as a Privy global wallet (docs/clear-integration.md): Clear's provider app, and what it shares.
    CLEAR_PRIVY_PROVIDER_APP_ID: secret(),
    CLEAR_WALLET_ACCESS: "read_only",
    LIVEPEER_API_KEY: secret(),
    // The escrow contract and creator fund (Base Sepolia on staging, Base in production); unset, claimable earnings stay owed.
    CHAIN_RPC_URL: secret(),
    CHAIN_ID: secret(),
    ESCROW_CONTRACT_ADDRESS: secret(),
    CREATOR_FUND_ADDRESS: secret(),
    USDC_ADDRESS: secret(),
    ...storage
  };

  const api = service("api", {
    source,
    build: build("@opencast/api", ["apps/api/**"]),
    deploy: { startCommand: "npm run start -w @opencast/api", preDeployCommand: ["npm run migrate -w @opencast/db"], healthcheckPath: "/health", healthcheckTimeout: 300, ...restart },
    env: {
      ...common,
      PORT: "8080",
      STORAGE_ROOT: "/tmp/opencast",
      // The minute jobs run in the worker, under its leader lock.
      JOBS: "off",
      WEB_ORIGIN: ["viewer", "control", "spots", "desk", "site", "tv"].map(origin).join(","),
      SERVE_WEB_APP: "false"
    }
  });

  const worker = service("worker", {
    source,
    build: build("@opencast/worker", ["apps/worker/**", "apps/api/**"]),
    deploy: { startCommand: "npm run start -w @opencast/worker", healthcheckPath: "/health", healthcheckTimeout: 300, numReplicas: 1, ...restart },
    volumeMounts: { "/data": workerCache },
    env: {
      ...common,
      PORT: "8080",
      STORAGE_ROOT: "/data/storage",
      WORKER_CACHE_DIR: "/data/cache",
      // Most of the volume (the cache fills 90% of what it's given; HLS and proof frames use the rest).
      WORKER_CACHE_GB: String(cacheGB - 0.5),
      // Fresh data: no station is on the old queue model.
      LEGACY_PLAYOUT: "off",
      // Only the worker sends transactions (the weekly escrow batch, the pool's fund share).
      SETTLEMENT_PRIVATE_KEY: secret()
    }
  });

  const control = service("control", {
    source,
    build: build("@opencast/control", ["apps/control/**"]),
    deploy: { startCommand: "npm run start -w @opencast/control", healthcheckPath: "/health", healthcheckTimeout: 300, ...restart },
    env: { API_PROXY_BASE_URL: "http://${{api.RAILWAY_PRIVATE_DOMAIN}}:8080", VITE_PRIVY_APP_ID: secret(), VITE_CLEAR_PRIVY_PROVIDER_APP_ID: secret() }
  });

  // The apps prompt's web apps: static, served from dist.
  const web = (name: string) =>
    service(name, {
      source,
      build: build(`@opencast/${name}`, [`apps/${name}/**`, "scripts/serve-static.mjs"]),
      deploy: { startCommand: `node scripts/serve-static.mjs apps/${name}/dist`, healthcheckPath: "/health", healthcheckTimeout: 120, ...restart },
      // Opencast's own Privy app (build time), and Clear's provider app for "Connect Clear".
      env: { VITE_API_BASE: origin("api"), VITE_PRIVY_APP_ID: secret(), VITE_CLEAR_PRIVY_PROVIDER_APP_ID: secret() }
    });

  return project("opencast", {
    environments: ["production", "staging"],
    resources: [Postgres, Redis, redisVolume, postgresVolume, workerCache, ...(media ? [media] : []), api, worker, control, web("viewer"), web("spots"), web("desk"), web("site"), web("tv")]
  });
});
