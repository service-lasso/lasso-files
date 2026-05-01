export const downloadFile = async (files) => {
  if (files.length === 0) return;

  try {
    const fileQuery = files.map((file) => `files=${encodeURIComponent(file._id)}`).join("&");
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "/api/file-system";
    const url = `${apiBaseUrl}/download?${fileQuery}`;

    const link = document.createElement("a");
    link.href = url;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (error) {
    return error;
  }
};
