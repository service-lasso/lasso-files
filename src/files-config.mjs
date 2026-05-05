const DEFAULT_ALLOWED_EXTENSIONS = [".txt", ".png", ".jpg", ".jpeg", ".pdf", ".doc", ".docx", ".exe"];
const DEFAULT_MAX_UPLOAD_MB = 300;

export function createFilesConfig(env = process.env) {
  const state = {
    allowedExtensions: parseAllowedExtensions(
      env.FILES_ALLOWED_EXTENSIONS ?? env.FILES_ACCEPTED_FILE_TYPES ?? DEFAULT_ALLOWED_EXTENSIONS.join(","),
    ),
    maxUploadMb: parsePositiveNumber(env.FILES_MAXSIZE_MB ?? env.FM_MAXSIZE, DEFAULT_MAX_UPLOAD_MB),
  };

  return {
    get maxUploadBytes() {
      return state.maxUploadMb * 1024 * 1024;
    },
    get maxUploadMb() {
      return state.maxUploadMb;
    },
    acceptedFileTypes() {
      return state.allowedExtensions.join(", ");
    },
    allowAllFiles() {
      return state.allowedExtensions.length === 0;
    },
    allowedExtensions() {
      return [...state.allowedExtensions];
    },
    updateAllowedExtensions(value) {
      state.allowedExtensions = parseAllowedExtensions(value);
      return this.toJSON();
    },
    isAllowed(filename) {
      if (state.allowedExtensions.length === 0) {
        return true;
      }
      const extension = extensionFromName(filename);
      return state.allowedExtensions.includes(extension);
    },
    toJSON() {
      return {
        allowedExtensions: [...state.allowedExtensions],
        acceptedFileTypes: state.allowedExtensions.join(", "),
        allowAllFiles: state.allowedExtensions.length === 0,
        maxUploadBytes: state.maxUploadMb * 1024 * 1024,
        maxUploadMb: state.maxUploadMb,
      };
    },
  };
}

export function parseAllowedExtensions(value) {
  if (Array.isArray(value)) {
    return normalizeAllowedExtensions(value);
  }

  if (value == null) {
    return [];
  }

  const raw = String(value).trim();
  if (!raw || raw === "*") {
    return [];
  }

  return normalizeAllowedExtensions(raw.split(","));
}

function normalizeAllowedExtensions(values) {
  return [...new Set(values.map(normalizeExtension).filter(Boolean))];
}

function normalizeExtension(value) {
  const normalized = String(value).trim().toLowerCase();
  if (!normalized || normalized === "*") {
    return null;
  }
  return normalized.startsWith(".") ? normalized : `.${normalized}`;
}

function extensionFromName(filename = "") {
  const name = String(filename).toLowerCase();
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index) : "";
}

function parsePositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
