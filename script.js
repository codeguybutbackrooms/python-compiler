const body = document.body;
let pyodide, pythonEditor;

const EDITOR_KEY = "pythonCode";
const PACKAGE_KEY = "installedPackages";

// Linting support
CodeMirror.registerHelper("lint", "python", function (text) {
  const found = [];
  try {
    pyodide.runPython(`compile(${JSON.stringify(text)}, "<input>", "exec")`);
  } catch (e) {
    const msg = e.toString();
    const lineMatch = msg.match(/line (\d+)/i);
    const line = lineMatch ? parseInt(lineMatch[1], 10) - 1 : 0;
    found.push({
      from: CodeMirror.Pos(line, 0),
      to: CodeMirror.Pos(line, 100),
      message: msg,
      severity: "error"
    });
  }
  return found;
});

async function main() {
  pyodide = await loadPyodide();

  const savedPackages = JSON.parse(localStorage.getItem(PACKAGE_KEY)) || [];
  if (savedPackages.length > 0) {
    await pyodide.loadPackage("micropip");
    for (const mod of savedPackages) {
      try {
        await pyodide.runPythonAsync(`
import micropip
await micropip.install("${mod}")
        `);
        console.log(`Auto-reinstalled: ${mod}`);
      } catch (err) {
        console.warn(`Failed to auto-reinstall ${mod}:`, err);
      }
    }
  }

  pythonEditor = CodeMirror.fromTextArea(document.getElementById("pythonEditor"), {
    mode: "python",
    theme: "material",
    lineNumbers: true,
    autoCloseBrackets: true,
    indentUnit: 4,
    tabSize: 4,
    smartIndent: true,
    lint: true,
    gutters: ["CodeMirror-lint-markers"]
  });

  // Load saved code
  const savedCode = localStorage.getItem(EDITOR_KEY);
  if (savedCode) {
    pythonEditor.setValue(savedCode);
  }

  // Auto-save on change
  pythonEditor.on("change", () => {
    localStorage.setItem(EDITOR_KEY, pythonEditor.getValue());
  });

  // Reveal the editor after everything is ready
  document.getElementById("loader").style.display = "none";
  document.getElementById("pythonEditor").style.display = "block";
}

main();

// Run button
document.getElementById("run").addEventListener("click", async () => {
  const outputDiv = document.getElementById("output");
  outputDiv.innerHTML = "";

  const rawCode = pythonEditor.getValue();
  const lines = rawCode.split("\n");
  const installed = JSON.parse(localStorage.getItem(PACKAGE_KEY)) || [];
  const codeLines = [];

  const micropipInstallRegex = /micropip\.install\s*\(\s*["']([^"']+)["']\s*\)/;
  const toInstall = [];

  for (let line of lines) {
    const match = line.match(micropipInstallRegex);
    if (match) {
      const mod = match[1];
      if (!installed.includes(mod)) {
        toInstall.push(mod);
      } else {
        outputDiv.innerHTML += `📦 <b>${mod}</b> is already installed.<br>`;
      }
    } else {
      codeLines.push(line);
    }
  }

  if (toInstall.length > 0) {
    await pyodide.loadPackage("micropip");

    for (const mod of toInstall) {
      outputDiv.innerHTML += `📦 Installing module <b>${mod}</b>...<br>`;
      try {
        await pyodide.runPythonAsync(`
import micropip
await micropip.install("${mod}")
        `);
        installed.push(mod);
        localStorage.setItem(PACKAGE_KEY, JSON.stringify(installed));
        outputDiv.innerHTML += `✅ Installed <b>${mod}</b>. See the <a href="installed-packages.html" target="_blank">Installed Packages</a><br><br>`;
      } catch (err) {
        outputDiv.innerHTML += `❌ Failed to install <b>${mod}</b>: ${err}<br><br>`;
        return;
      }
    }
  }

  if (codeLines.length === 0) {
    codeLines.push("pass");
  }
  const finalCode = codeLines.join("\n");

  const inputRegex = /input\s*\((?:\"([^\"]*)\"|'([^']*)')?\)/g;
  let inputs = [];
  let match;
  while ((match = inputRegex.exec(finalCode))) {
    const promptText = match[1] || match[2] || "Input:";
    const response = prompt(promptText);
    inputs.push(response === null ? "None" : JSON.stringify(response));
  }

  const wrappedCode = `
import sys
import io
sys.stdout = io.StringIO()
_input_values = [${inputs.join(",")}]
def input(prompt=None):
    return _input_values.pop(0)
try:
${finalCode.split("\n").map(line => "    " + line).join("\n")}
except Exception as e:
    import traceback; traceback.print_exc()
result = sys.stdout.getvalue()
`;

  try {
    await pyodide.runPythonAsync(wrappedCode);
    const result = pyodide.runPython("result");
    outputDiv.innerHTML += `<pre>${result}</pre>`;
  } catch (err) {
    outputDiv.innerHTML += `<pre>Error:\n${err}</pre>`;
  }
});

// Show installed packages
document.getElementById("packages").addEventListener("click", () => {
  window.location.href = "installed-packages.html";
});

// Clear editor button
document.getElementById("clear-editor").addEventListener("click", () => {
  const confirmed = confirm("Clear all code from the editor?");
  if (confirmed) {
    pythonEditor.setValue("");
    localStorage.removeItem(EDITOR_KEY);
  }
});
