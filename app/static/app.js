const form = document.querySelector("#tool-form");
const fileInput = document.querySelector("#file");
const fileName = document.querySelector("#file-name");
const markField = document.querySelector("#mark-field");
const regionsField = document.querySelector("#regions-field");
const result = document.querySelector("#result");
const submit = document.querySelector("#submit");

function updateMode() {
  const operation = new FormData(form).get("operation");
  markField.classList.toggle("hidden", operation !== "visible");
  regionsField.classList.toggle("hidden", operation !== "erase");
}

fileInput.addEventListener("change", () => {
  fileName.textContent = fileInput.files[0]?.name || "未选择文件";
});

form.addEventListener("change", updateMode);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  result.className = "result";
  result.textContent = "处理中，请稍候...";
  submit.disabled = true;

  try {
    const response = await fetch("/api/process", {
      method: "POST",
      body: new FormData(form),
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.detail || "处理失败");
    }
    result.innerHTML = `<p>处理完成。</p><a href="${body.download_url}">下载结果</a>`;
  } catch (error) {
    result.classList.add("error");
    result.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

updateMode();

