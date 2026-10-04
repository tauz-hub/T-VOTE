import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Lição do TPS 2012: aleatoriedade fraca ou semeada por horário quebrou o
    // sigilo do voto. Toda aleatoriedade deve vir de crypto.getRandomValues.
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message: "Proibido: use bytesAleatorios()/inteiroAleatorio() de lib/crypto/codificacao (CSPRNG).",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "data/**",
  ]),
]);

export default eslintConfig;
