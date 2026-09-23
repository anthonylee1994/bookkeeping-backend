import swc from "unplugin-swc";
import {defineConfig} from "vitest/config";

export default defineConfig({
    plugins: [swc.vite()],
    test: {
        globals: true,
        environment: "node",
        include: ["test/**/*.spec.ts"],
        setupFiles: ["test/setup.ts"],
        globalSetup: ["test/global-setup.ts"],
        fileParallelism: false,
        maxWorkers: 1,
        isolate: false,
        testTimeout: 60_000,
        hookTimeout: 120_000,
    },
});
