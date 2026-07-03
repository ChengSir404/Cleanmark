const form = document.querySelector("#tool-form");
const fileInput = document.querySelector("#file");
const fileName = document.querySelector("#file-name");
const markField = document.querySelector("#mark-field");
const regionsField = document.querySelector("#regions-field");
const result = document.querySelector("#result");
const submit = document.querySelector("#submit");
const modeTitle = document.querySelector("#mode-title");
const statusPill = document.querySelector("#status-pill");
const uploadZone = document.querySelector("#upload-zone");
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
    uploadZone.classList.remove("has-image");
    previewImage.removeAttribute("src");
    fileName.textContent = "支持批量上传 PNG、JPG、WEBP、BMP、TIFF";
    return;
  }

  previewUrl = URL.createObjectURL(file);
  previewImage.src = previewUrl;
  uploadZone.classList.add("has-image");
  const count = fileInput.files.length;
  fileName.textContent = count > 1 ? `${file.name} 等 ${count} 张图片` : file.name;
}

function setFileList(files) {
  if (!files?.length) return;
  fileInput.files = files;
  setPreview(files[0]);
}

fileInput.addEventListener("change", () => {
  setPreview(fileInput.files[0]);
});

uploadZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  uploadZone.classList.add("dragging");
});

uploadZone.addEventListener("dragleave", () => {
  uploadZone.classList.remove("dragging");
});

uploadZone.addEventListener("drop", (event) => {
  event.preventDefault();
  uploadZone.classList.remove("dragging");
  setFileList(event.dataTransfer.files);
});

form.addEventListener("change", updateMode);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  result.className = "result";
  const fileCount = fileInput.files.length;
  result.textContent = fileCount > 1 ? `正在处理 ${fileCount} 张图片，请稍候...` : "处理中，请稍候...";
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
    const fileLinks = Array.isArray(body.files)
      ? body.files
          .map(
            (file) =>
              `<li><span>${file.original_name || file.name}</span><a href="${file.download_url}">单独下载</a></li>`,
          )
          .join("")
      : "";
    result.innerHTML = `
      <p>处理完成，共 ${body.count || 1} 张</p>
      <div class="download-actions">
        <a class="download-all" href="${body.download_all_url || body.download_url}">下载全部</a>
      </div>
      ${fileLinks ? `<ul class="download-list">${fileLinks}</ul>` : ""}
    `;
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
