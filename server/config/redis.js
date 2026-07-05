import redis from "redis";
import dotenv from "dotenv";

dotenv.config();

function assertRedisPasswordForProduction() {
  if (process.env.NODE_ENV !== "production") return;

  const url = process.env.REDIS_URL;
  if (url) {
    try {
      const parsed = new URL(url);
      if (parsed.password) return;
    } catch (e) {
      // Invalid URL
    }
  }

  const password = process.env.REDIS_PASSWORD?.trim();
  if (!password) {
    console.error(
      "✗ REDIS_PASSWORD (or REDIS_URL with password) must be set when NODE_ENV=production. " +
        "Use a strong password and match it in your Redis server config.",
    );
    process.exit(1);
  }
}

function buildRedisUrl() {
  if (process.env.REDIS_URL) {
    return process.env.REDIS_URL;
  }
  const host = process.env.REDIS_HOST || "localhost";
  const port = process.env.REDIS_PORT || "6379";
  const password = process.env.REDIS_PASSWORD?.trim();

  if (password) {
    return `redis://:${encodeURIComponent(password)}@${host}:${port}`;
  }
  return `redis://${host}:${port}`;
}

assertRedisPasswordForProduction();

const client = redis.createClient({
  url: buildRedisUrl(),
});

client.on("error", (err) => console.error("Redis Error:", err));
client.on("connect", () => console.log("✓ Redis connected"));

export default client;
