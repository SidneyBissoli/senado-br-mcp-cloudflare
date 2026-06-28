import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  OPENAI_APP_WIDGET_DOMAIN,
  OPENAI_APP_WIDGET_URI,
} from "./app-surface.js";

export const OPENAI_APP_WIDGET_RESOURCE_NAME = "senado-openai-app-dashboard";
export const OPENAI_APP_WIDGET_MIME_TYPE = "text/html;profile=mcp-app";
export const OPENAI_APP_WIDGET_DESCRIPTION =
  "Painel compacto para resultados de dados abertos do Senado, com metricas, itens principais e fonte.";

export const OPENAI_APP_WIDGET_META = {
  ui: {
    prefersBorder: true,
    domain: OPENAI_APP_WIDGET_DOMAIN,
    csp: {
      connectDomains: [],
      resourceDomains: [],
    },
  },
  "openai/widgetDescription": OPENAI_APP_WIDGET_DESCRIPTION,
  "openai/widgetPrefersBorder": true,
  "openai/widgetCSP": {
    connect_domains: [],
    resource_domains: [],
  },
  "openai/widgetDomain": OPENAI_APP_WIDGET_DOMAIN,
};

export const OPENAI_APP_WIDGET_HTML = String.raw`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root {
      color-scheme: light dark;
      --bg: #fafafa;
      --panel: #ffffff;
      --text: #1f2933;
      --muted: #5f6f7a;
      --line: #d8dee4;
      --accent: #0f766e;
      --accent-soft: #e0f2f1;
      --gold: #9a6700;
      --gold-soft: #fff4ce;
      --chip: #eef2f7;
      --shadow: 0 14px 40px rgba(15, 23, 42, 0.08);
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #101418;
        --panel: #171c21;
        --text: #edf2f7;
        --muted: #a5b4bf;
        --line: #303944;
        --accent: #2dd4bf;
        --accent-soft: #123d3a;
        --gold: #f4c430;
        --gold-soft: #403616;
        --chip: #222b34;
        --shadow: none;
      }
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font: 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .wrap {
      padding: 14px;
    }

    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
      overflow: hidden;
    }

    .head {
      display: grid;
      gap: 6px;
      padding: 16px;
      border-bottom: 1px solid var(--line);
      background: linear-gradient(90deg, var(--accent-soft), transparent 64%);
    }

    .eyebrow {
      color: var(--accent);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0;
      text-transform: uppercase;
    }

    h1 {
      margin: 0;
      font-size: 18px;
      line-height: 1.2;
      letter-spacing: 0;
    }

    .sub {
      margin: 0;
      color: var(--muted);
      font-size: 13px;
    }

    .metrics {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(112px, 1fr));
      gap: 8px;
      padding: 12px 16px 4px;
    }

    .metric {
      min-width: 0;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--chip);
      padding: 9px 10px;
    }

    .metric b {
      display: block;
      overflow-wrap: anywhere;
      font-size: 15px;
      line-height: 1.15;
    }

    .metric span {
      display: block;
      margin-top: 3px;
      color: var(--muted);
      font-size: 12px;
    }

    .items {
      display: grid;
      gap: 8px;
      padding: 12px 16px 16px;
    }

    .item {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
      background: var(--panel);
    }

    .item-title {
      margin: 0 0 8px;
      font-weight: 700;
      overflow-wrap: anywhere;
    }

    .kv {
      display: grid;
      grid-template-columns: minmax(86px, 0.36fr) minmax(0, 1fr);
      gap: 5px 10px;
      font-size: 12px;
    }

    .k {
      color: var(--muted);
      overflow-wrap: anywhere;
    }

    .v {
      overflow-wrap: anywhere;
    }

    .source {
      display: grid;
      gap: 4px;
      padding: 12px 16px 16px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 12px;
    }

    .source strong {
      color: var(--gold);
      font-weight: 700;
    }

    .empty {
      padding: 18px 16px;
      color: var(--muted);
    }

    @media (max-width: 480px) {
      .wrap {
        padding: 10px;
      }

      .head,
      .metrics,
      .items,
      .source {
        padding-left: 12px;
        padding-right: 12px;
      }

      .kv {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <main class="panel" id="app" aria-live="polite"></main>
  </div>
  <script>
    (() => {
      const appRoot = document.getElementById("app");
      const hiddenKeys = new Set(["provenance", "attribution", "meta"]);
      const preferredTitleKeys = ["nome", "nomeParlamentar", "identificacao", "sigla", "titulo", "descricao", "ementa"];

      function bridge() {
        return window.openai || {};
      }

      function readOutput() {
        const openai = bridge();
        const metadata = openai.toolResponseMetadata || {};
        return openai.toolOutput ||
          metadata.mcp_tool_result?.structuredContent ||
          metadata.call_tool_result?.structuredContent ||
          null;
      }

      function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
      }

      function labelFor(key) {
        return String(key)
          .replace(/([a-z])([A-Z])/g, "$1 $2")
          .replace(/[_-]+/g, " ")
          .replace(/\b\w/g, (m) => m.toUpperCase());
      }

      function asText(value) {
        if (value === null || value === undefined || value === "") return "Nao informado";
        if (typeof value === "boolean") return value ? "Sim" : "Nao";
        if (typeof value === "number") return new Intl.NumberFormat("pt-BR").format(value);
        if (Array.isArray(value)) return value.length + " itens";
        if (typeof value === "object") {
          const pairs = Object.entries(value)
            .filter(([, v]) => v !== null && v !== undefined && typeof v !== "object")
            .slice(0, 3)
            .map(([k, v]) => labelFor(k) + ": " + asText(v));
          return pairs.length ? pairs.join(" · ") : "Dados estruturados";
        }
        const text = String(value).replace(/\s+/g, " ").trim();
        return text.length > 180 ? text.slice(0, 177) + "..." : text;
      }

      function publicEntries(data) {
        if (!data || typeof data !== "object" || Array.isArray(data)) return [];
        return Object.entries(data).filter(([key]) => !hiddenKeys.has(key));
      }

      function firstCollection(data) {
        return publicEntries(data).find(([, value]) => Array.isArray(value) && value.length > 0) || null;
      }

      function titleFromRecord(record, fallback) {
        if (!record || typeof record !== "object" || Array.isArray(record)) return fallback;
        for (const key of preferredTitleKeys) {
          if (record[key]) return asText(record[key]);
        }
        return fallback;
      }

      function titleFor(data, collection) {
        if (data?.identificacao || data?.nome || data?.titulo) {
          return titleFromRecord(data, "Resultado do Senado");
        }
        if (collection) return labelFor(collection[0]);
        return "Resultado do Senado";
      }

      function subtitleFor(data, collection) {
        const count = typeof data?.count === "number" ? data.count : null;
        if (collection && count !== null) {
          return count + " registro" + (count === 1 ? "" : "s") + " em " + labelFor(collection[0]).toLowerCase();
        }
        if (collection) {
          return collection[1].length + " registro" + (collection[1].length === 1 ? "" : "s") + " exibido" + (collection[1].length === 1 ? "" : "s");
        }
        return "Dados oficiais retornados pela ferramenta";
      }

      function metricEntries(data, collection) {
        const skip = new Set(collection ? [collection[0]] : []);
        const metrics = publicEntries(data)
          .filter(([key, value]) => !skip.has(key) && (typeof value === "number" || typeof value === "boolean" || typeof value === "string"))
          .slice(0, 4);
        if (collection && !metrics.some(([key]) => key === "count")) {
          metrics.unshift(["itens", collection[1].length]);
        }
        return metrics.slice(0, 4);
      }

      function detailEntries(record) {
        if (!record || typeof record !== "object" || Array.isArray(record)) return [];
        return Object.entries(record)
          .filter(([key, value]) => !hiddenKeys.has(key) && !preferredTitleKeys.includes(key) && value !== undefined)
          .slice(0, 6);
      }

      function renderItems(data, collection, parent) {
        const section = el("section", "items");
        const rows = collection ? collection[1].slice(0, 8) : [data];

        for (const [index, row] of rows.entries()) {
          const card = el("article", "item");
          card.appendChild(el("p", "item-title", titleFromRecord(row, "Item " + (index + 1))));

          const grid = el("div", "kv");
          const entries = detailEntries(row);
          if (entries.length === 0) {
            grid.appendChild(el("span", "k", "Valor"));
            grid.appendChild(el("span", "v", asText(row)));
          } else {
            for (const [key, value] of entries) {
              grid.appendChild(el("span", "k", labelFor(key)));
              grid.appendChild(el("span", "v", asText(value)));
            }
          }
          card.appendChild(grid);
          section.appendChild(card);
        }

        parent.appendChild(section);
      }

      function renderSource(data, parent) {
        const source = data?.provenance;
        const urls = Array.isArray(data?.attribution) ? data.attribution : [];
        if (!source && urls.length === 0) return;

        const box = el("footer", "source");
        const title = el("strong", null, source?.source || "Fonte");
        box.appendChild(title);
        if (source?.source_url || urls[0]) box.appendChild(el("span", null, source?.source_url || urls[0]));
        if (source?.retrieved_at) box.appendChild(el("span", null, "Extraido em " + source.retrieved_at));
        if (source?.reference_period) box.appendChild(el("span", null, "Competencia " + source.reference_period));
        parent.appendChild(box);
      }

      function render() {
        const data = readOutput();
        appRoot.replaceChildren();

        if (!data || typeof data !== "object") {
          appRoot.appendChild(el("div", "empty", "Aguardando dados do Senado."));
          return;
        }

        const collection = firstCollection(data);
        const head = el("header", "head");
        head.appendChild(el("div", "eyebrow", "Dados Abertos Senado BR"));
        head.appendChild(el("h1", null, titleFor(data, collection)));
        head.appendChild(el("p", "sub", subtitleFor(data, collection)));
        appRoot.appendChild(head);

        const metrics = metricEntries(data, collection);
        if (metrics.length > 0) {
          const metricGrid = el("section", "metrics");
          for (const [key, value] of metrics) {
            const metric = el("div", "metric");
            metric.appendChild(el("b", null, asText(value)));
            metric.appendChild(el("span", null, labelFor(key)));
            metricGrid.appendChild(metric);
          }
          appRoot.appendChild(metricGrid);
        }

        renderItems(data, collection, appRoot);
        renderSource(data, appRoot);
      }

      document.addEventListener("DOMContentLoaded", render);
      window.addEventListener("message", () => window.setTimeout(render, 0));

      let attempts = 0;
      const timer = window.setInterval(() => {
        render();
        attempts += 1;
        if (readOutput() || attempts > 20) window.clearInterval(timer);
      }, 250);
      render();
    })();
  </script>
</body>
</html>`;

export function registerOpenAiAppWidget(server: McpServer) {
  server.registerResource(
    OPENAI_APP_WIDGET_RESOURCE_NAME,
    OPENAI_APP_WIDGET_URI,
    {
      title: "Painel de dados do Senado",
      description: OPENAI_APP_WIDGET_DESCRIPTION,
      mimeType: OPENAI_APP_WIDGET_MIME_TYPE,
    },
    (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: OPENAI_APP_WIDGET_MIME_TYPE,
          text: OPENAI_APP_WIDGET_HTML,
          _meta: OPENAI_APP_WIDGET_META,
        },
      ],
    }),
  );
}
