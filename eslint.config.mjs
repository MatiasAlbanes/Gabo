import next from "eslint-config-next";

const config = [
  ...next,
  { ignores: [".open-next/**", ".wrangler/**", ".stack-data/**", ".next/**", "node_modules/**", "playwright-report/**", "test-results/**"] },
  { rules: { "react-hooks/set-state-in-effect": "off" } },
  { files: ["tests/**"], rules: { "react-hooks/rules-of-hooks": "off" } }, // `use` de Playwright no es un hook de React
];

export default config;
