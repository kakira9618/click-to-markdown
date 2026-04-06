chrome.action.onClicked.addListener(async (tab) => {
  if (
    !tab?.id ||
    !tab.url ||
    tab.url.startsWith("chrome://") ||
    tab.url.startsWith("edge://")
  ) {
    await setBadge("NO", "#d32f2f");
    return;
  }

  try {
    // Readability を注入（readability.js を同梱している前提）
    // 使わないならこの executeScript(files) を消してOK（本文抽出はfallbackに寄る）
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["readability.js"],
    });

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractMarkdownishAndCopy,
    });

    await setBadge(result?.ok ? "OK" : "ERR", result?.ok ? "#2e7d32" : "#d32f2f");
  } catch (e) {
    await setBadge("ERR", "#d32f2f");
  }

  async function extractMarkdownishAndCopy() {
    try {
      const url = location.href;

      // <title>の中身を優先
      const titleEl = document.querySelector("title");
      const rawTitle = (titleEl?.textContent ?? document.title ?? "").trim();
      const title = rawTitle.replace(/\s*\n\s*/g, " ").trim();

      // 1) 本文HTMLを用意（Readability → fallback）
      let contentHtml = "";
      let method = "";

      if (typeof Readability !== "undefined") {
        try {
          // Readability は document を破壊的に触ることがあるので clone
          const docClone = document.cloneNode(true);
          const reader = new Readability(docClone, { keepClasses: true });
          const parsed = reader.parse();
          if (parsed?.content && parsed.content.trim()) {
            contentHtml = parsed.content;
            method = "readability";
          }
        } catch (_) {
          // ignore and fallback
        }
      }

      if (!contentHtml) {
        const main =
          document.querySelector("article") ||
          document.querySelector("main") ||
          document.querySelector('[role="main"]') ||
          document.querySelector("#content, #main, .content, .main") ||
          null;

        contentHtml = (main?.innerHTML || document.body?.innerHTML || "").trim();
        method = "fallback";
      }

      // 2) HTML -> Markdown-ish（imgはHTMLのまま）
      const bodyText = htmlToMarkdownishKeepingImgs(contentHtml);

      // 3) 先頭に ---- を付けてコピー
      const payload = `----\n${title}\n${url}\n\n${bodyText}`;

      // Clipboard API -> execCommand fallback
      try {
        await navigator.clipboard.writeText(payload);
        return { ok: true, method };
      } catch (_) {
        const ta = document.createElement("textarea");
        ta.value = payload;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.top = "-1000px";
        ta.style.left = "-1000px";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        return { ok, method: method + "+execCommand" };
      }
    } catch (err) {
      return { ok: false, error: String(err) };
    }

    // =========================
    // HTML -> Markdown-ish
    // =========================
    function htmlToMarkdownishKeepingImgs(html) {
      const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
      const root = doc.body;

      const out = [];
      const push = (line) => out.push(line);

      const ensureBlankLine = () => {
        if (out.length === 0) return;
        if (out[out.length - 1] !== "") out.push("");
      };

      const trimEndBlankLines = () => {
        while (out.length > 0 && out[out.length - 1] === "") out.pop();
      };

      const normalizeInline = (s) =>
        String(s)
          .replace(/\s+/g, " ")
          .trim();

      const escapeTableCell = (s) =>
        String(s)
          .replace(/\r?\n/g, " ")
          .replace(/\|/g, "\\|")
          .trim();

      const escapeAttr = (s) =>
        String(s)
          .replace(/&/g, "&amp;")
          .replace(/"/g, "&quot;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");

      const imgToHtml = (imgEl) => {
        const src = imgEl.getAttribute("src") || "";
        const alt = imgEl.getAttribute("alt");
        const title = imgEl.getAttribute("title");

        const attrs = [];
        attrs.push(`src="${escapeAttr(src)}"`);
        if (alt != null && alt !== "") attrs.push(`alt="${escapeAttr(alt)}"`);
        if (title != null && title !== "") attrs.push(`title="${escapeAttr(title)}"`);

        return `<img ${attrs.join(" ")}>`;
      };

      // inline要素を “1行文字列” にする（imgは <img ...> を差し込む）
      function inlineText(node) {
        if (!node) return "";

        if (node.nodeType === Node.TEXT_NODE) {
          return node.nodeValue || "";
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return "";

        const el = node;
        const tag = el.tagName;

        if (tag === "IMG") return imgToHtml(el);
        if (tag === "BR") return " ";

        if (tag === "A") {
          const href = el.getAttribute("href") || "";
          const txt = normalizeInline(Array.from(el.childNodes).map(inlineText).join(""));
          if (!href) return txt;
          if (!txt) return href;
          return `[${txt}](${href})`;
        }

        if (tag === "CODE") {
          const txt = normalizeInline(el.textContent || "");
          if (!txt) return "";
          return "`" + txt + "`";
        }

        // strong/em/emphasisなどはそのまま中身だけ（必要なら ** や _ を付けてもよい）
        return Array.from(el.childNodes).map(inlineText).join("");
      }

      // ブロック変換
      function walk(node, ctx = { listDepth: 0 }) {
        if (!node) return;

        if (node.nodeType === Node.TEXT_NODE) {
          // ブロック直下のテキストは段落扱いに寄せる
          const t = normalizeInline(node.nodeValue || "");
          if (t) {
            push(t);
            ensureBlankLine();
          }
          return;
        }

        if (node.nodeType !== Node.ELEMENT_NODE) return;

        const el = node;
        const tag = el.tagName;

        // 無視
        if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(tag)) return;

        // 見出し
        if (tag === "H1" || tag === "H2") {
          const level = tag === "H1" ? "#" : "##";
          const line = normalizeInline(Array.from(el.childNodes).map(inlineText).join(""));
          if (line) push(`${level} ${line}`);
          ensureBlankLine();
          return;
        }

        // 段落（必ず1行）
        if (tag === "P") {
          const line = normalizeInline(Array.from(el.childNodes).map(inlineText).join(""));
          if (line) push(line);
          ensureBlankLine();
          return;
        }

        // 画像（ブロックとして出す：空行ルールあり）
        if (tag === "IMG") {
          push(imgToHtml(el));
          ensureBlankLine();
          return;
        }

        // 箇条書き（liは - ）
        if (tag === "UL" || tag === "OL") {
          const depth = ctx.listDepth || 0;
          const indent = "  ".repeat(depth);

          const items = Array.from(el.children).filter((c) => c.tagName === "LI");
          for (const li of items) {
            // li の直下テキスト（ネストUL/OLは除外）
            const parts = [];
            for (const child of Array.from(li.childNodes)) {
              if (child.nodeType === Node.ELEMENT_NODE) {
                const ctag = child.tagName;
                if (ctag === "UL" || ctag === "OL") continue;
              }
              parts.push(inlineText(child));
            }
            const head = normalizeInline(parts.join(""));
            push(`${indent}- ${head}`.trimEnd());

            // ネストリスト
            for (const child of Array.from(li.children)) {
              if (child.tagName === "UL" || child.tagName === "OL") {
                walk(child, { listDepth: depth + 1 });
              }
            }
          }

          ensureBlankLine();
          return;
        }

        // テーブル -> Markdown table
        if (tag === "TABLE") {
          const md = tableToMarkdown(el);
          if (md) {
            push(md);
            ensureBlankLine();
          }
          return;
        }

        // pre -> fenced code block
        if (tag === "PRE") {
          const code = (el.textContent || "").replace(/\s+$/g, "");
          push("```");
          push(code);
          push("```");
          ensureBlankLine();
          return;
        }

        // blockquote（簡易）
        if (tag === "BLOCKQUOTE") {
          const txt = (el.textContent || "").trim();
          if (txt) {
            for (const line of txt.split(/\r?\n/)) {
              const t = line.trim();
              if (t) push(`> ${t}`);
            }
            ensureBlankLine();
          }
          return;
        }

        // br（ブロック直下なら空行相当）
        if (tag === "BR") {
          ensureBlankLine();
          return;
        }

        // その他：子を辿る
        for (const child of Array.from(el.childNodes)) {
          walk(child, ctx);
        }
      }

      function tableToMarkdown(tableEl) {
        const rows = Array.from(tableEl.querySelectorAll("tr"));
        if (rows.length === 0) return "";

        const grid = rows
          .map((tr) =>
            Array.from(tr.querySelectorAll("th,td")).map((cell) => {
              const raw = Array.from(cell.childNodes).map(inlineText).join("");
              return escapeTableCell(normalizeInline(raw));
            })
          )
          .filter((r) => r.length > 0);

        if (grid.length === 0) return "";

        // thが含まれる最初の行をヘッダに、なければ1行目
        let headerIndex = 0;
        for (let i = 0; i < rows.length && i < grid.length; i++) {
          if (rows[i].querySelector("th")) {
            headerIndex = i;
            break;
          }
        }

        const header = grid[headerIndex];
        const body = grid.filter((_, i) => i !== headerIndex);

        const cols = Math.max(header.length, ...body.map((r) => r.length), 1);
        const pad = (r) => Array.from({ length: cols }, (_, i) => r[i] ?? "");

        const h = pad(header);
        const sep = Array.from({ length: cols }, () => "---");

        const lines = [];
        lines.push(`| ${h.join(" | ")} |`);
        lines.push(`| ${sep.join(" | ")} |`);
        for (const r of body) {
          const pr = pad(r);
          lines.push(`| ${pr.join(" | ")} |`);
        }
        return lines.join("\n");
      }

      // root直下から処理
      for (const child of Array.from(root.childNodes)) {
        walk(child, { listDepth: 0 });
      }

      trimEndBlankLines();
      return out.join("\n");
    }
  }

  async function setBadge(text, color) {
    try {
      await chrome.action.setBadgeText({ text });
      await chrome.action.setBadgeBackgroundColor({ color });
      setTimeout(() => chrome.action.setBadgeText({ text: "" }), 1200);
    } catch (_) {}
  }
});
