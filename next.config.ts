import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // a raiz é sempre esta pasta: um package-lock solto numa pasta acima (comum
  // em Downloads ou na pasta do usuário) não pode mudar a raiz do projeto
  turbopack: { root: __dirname },
  outputFileTracingRoot: __dirname,
  // better-sqlite3 é módulo nativo: fica fora do bundle do servidor
  serverExternalPackages: ["better-sqlite3"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
