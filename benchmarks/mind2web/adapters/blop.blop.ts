import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildMind2WebPrompt,
  loadMind2WebTasks,
  type Mind2WebFilters,
} from "../core.js";

const here = dirname(fileURLToPath(import.meta.url));
const tasksPath = process.env.MIND2WEB_TASKS_PATH
  ? resolve(process.env.MIND2WEB_TASKS_PATH)
  : join(here, "..", "data", "tasks.json");

const filters: Mind2WebFilters = {
  split: process.env.BENCH_SPLIT?.trim(),
  website: process.env.BENCH_WEBSITE?.trim(),
  limit: process.env.BENCH_LIMIT ? Number(process.env.BENCH_LIMIT) : undefined,
};

export default loadMind2WebTasks(tasksPath, filters).map((task) => ({
  name: `mind2web > ${task.split} > ${task.website} > ${task.id ?? "task"}`,
  goal: `Open ${task.start_url}.\n${buildMind2WebPrompt(task)}`,
}));
