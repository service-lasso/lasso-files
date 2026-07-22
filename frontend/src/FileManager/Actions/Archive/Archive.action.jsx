import { useState } from "react";
import Button from "../../../components/Button/Button";
import { useSelection } from "../../../contexts/SelectionContext";
import { useTranslation } from "../../../contexts/TranslationProvider";
import "./Archive.action.scss";

const ArchiveAction = ({ triggerAction, onArchive }) => {
  const [status, setStatus] = useState("idle");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const { selectedFiles, setSelectedFiles } = useSelection();
  const t = useTranslation();
  const actionLabel =
    selectedFiles.length === 1 && selectedFiles[0]?.isDirectory ? t("archiveFolder") : t("archiveSelection");

  const handleArchive = async () => {
    setStatus("running");
    setError("");
    setResult(null);
    try {
      const archiveResult = await onArchive(selectedFiles);
      setResult(archiveResult || {});
      setStatus("success");
      setSelectedFiles([]);
    } catch (archiveError) {
      setError(archiveError?.message || t("archiveFailed"));
      setStatus("error");
    }
  };

  const archiveName = result?.archiveName || result?.name || result?.artifact?.name || result?.artifactName;
  const archiveSize = result?.size || result?.artifact?.size;
  const checksum = result?.checksum || result?.artifact?.checksum;
  const downloadUrl = result?.downloadUrl || result?.artifact?.downloadUrl || result?.artifact?.url;

  return (
    <div className="file-archive-action">
      {status === "idle" && (
        <>
          <p>{t("archiveConfirm", { count: selectedFiles.length, format: ".7z" })}</p>
          <div className="file-archive-actions">
            <Button type="secondary" onClick={() => triggerAction.close()}>
              {t("cancel")}
            </Button>
            <Button onClick={handleArchive}>{actionLabel}</Button>
          </div>
        </>
      )}

      {status === "running" && (
        <p className="file-archive-status" data-testid="archive-running">
          {t("archiveRunning")}
        </p>
      )}

      {status === "success" && (
        <div className="file-archive-result" data-testid="archive-result">
          <p>{t("archiveCreated")}</p>
          {archiveName && <p>{archiveName}</p>}
          {archiveSize && <p>{t("archiveSize", { size: archiveSize })}</p>}
          {checksum && <p>{t("archiveChecksum", { checksum })}</p>}
          <div className="file-archive-actions">
            {downloadUrl && (
              <a className="file-archive-download" href={downloadUrl}>
                {t("download")}
              </a>
            )}
            <Button type="secondary" onClick={() => triggerAction.close()}>
              {t("close")}
            </Button>
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="file-archive-error" data-testid="archive-error">
          <p>{error}</p>
          <div className="file-archive-actions">
            <Button type="secondary" onClick={() => triggerAction.close()}>
              {t("close")}
            </Button>
            <Button onClick={handleArchive}>{t("retry")}</Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ArchiveAction;
