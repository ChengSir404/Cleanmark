const form = document.querySelector("#tool-form");
const fileInput = document.querySelector("#file");
const fileName = document.querySelector("#file-name");
const markField = document.querySelector("#mark-field");
const regionsField = document.querySelector("#regions-field");
const result = document.querySelector("#result");
const submit = document.querySelector("#submit");
const modeTitle = document.querySelector("#mode-title");
const statusPill = document.querySelector("#status-pill");
const preview = document.querySelector("#preview");
const previewImage = document.querySelector("#preview-image");

const modeLabels = {
  visible: "已知可见水印",
  metadata: "元数据清理",
  erase: "指定区域擦除",
};

let previewUrl = "";

function currentOperation() {
  return new FormData(form).get("operation");
}

function updateMode() {
  const operation = currentOperation();
  markField.classList.toggle("hidden", operation !== "visible");
  regionsField.classList.toggle("hidden", operation !== "erase");
  modeTitle.textContent = modeLabels[operation] || "处理任务";
}

function setStatus(text) {
  statusPill.textContent = text;
}

function setPreview(file) {
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
  }

  if (!file) {
    preview.classList.remove("has-image");
    previewImage.removeAttribute("src");
    fileName.textContent = "PNG、JPG、WEBP、BMP、TIFF";
    return;
  }

  previewUrl = URL.createObjectURL(file);
  previewImage.src = previewUrl;
  preview.classList.add("has-image");
  fileName.textContent = file.name;
}

fileInput.addEventListener("change", () => {
  setPreview(fileInput.files[0]);
});

form.addEventListener("change", updateMode);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  result.className = "result";
  result.textContent = "处理中，请稍候...";
  submit.disabled = true;
  setStatus("Working");

  try {
    const response = await fetch("/api/process", {
      method: "POST",
      body: new FormData(form),
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.detail || "处理失败");
    }
    result.innerHTML = `<p>处理完成</p><a href="${body.download_url}">下载结果</a>`;
    setStatus("Done");
  } catch (error) {
    result.classList.add("error");
    result.textContent = error.message;
    setStatus("Error");
  } finally {
    submit.disabled = false;
  }
});

updateMode();
