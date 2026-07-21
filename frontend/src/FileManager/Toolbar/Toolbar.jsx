import { useState } from "react";
import { BsCopy, BsFolderPlus, BsGridFill, BsScissors } from "react-icons/bs";
import { FiRefreshCw } from "react-icons/fi";
import {
  MdClear,
  MdOutlineDelete,
  MdOutlineFileDownload,
  MdOutlineFileUpload,
} from "react-icons/md";
import { BiRename } from "react-icons/bi";
import { FaListUl, FaRegPaste } from "react-icons/fa6";
import LayoutToggler from "./LayoutToggler";
import { useFileNavigation } from "../../contexts/FileNavigationContext";
import { useSelection } from "../../contexts/SelectionContext";
import { useClipBoard } from "../../contexts/ClipboardContext";
import { useLayout } from "../../contexts/LayoutContext";
import { validateApiCallback } from "../../utils/validateApiCallback";
import { useTranslation } from "../../contexts/TranslationProvider";
import "./Toolbar.scss";

const Toolbar = ({ onLayoutChange, onRefresh, triggerAction, permissions }) => {
  const [showToggleViewMenu, setShowToggleViewMenu] = useState(false);
  const {
    activeSourceId,
    setActiveSourceId,
    sourceOptions,
    selectedSource,
    currentFolder,
    canMutateInCurrentLocation,
    isCurrentLocationReadOnly,
  } = useFileNavigation();
  const { selectedFiles, setSelectedFiles, handleDownload } = useSelection();
  const { clipBoard, setClipBoard, handleCutCopy, handlePasting } = useClipBoard();
  const { activeLayout } = useLayout();
  const t = useTranslation();
  const hasReadOnlySelection = selectedFiles.some((file) => file.readOnly || file.virtual);
  const canPasteHere = canMutateInCurrentLocation && !!clipBoard;
  const writePermissions = {
    ...permissions,
    create: permissions.create && canMutateInCurrentLocation,
    upload: permissions.upload && canMutateInCurrentLocation,
    move: permissions.move && !hasReadOnlySelection,
    rename: permissions.rename && !hasReadOnlySelection,
    delete: permissions.delete && !hasReadOnlySelection,
  };

  const handleSourceChange = (event) => {
    setSelectedFiles([]);
    setClipBoard(null);
    setActiveSourceId(event.target.value);
  };

  // Toolbar Items
  const toolbarLeftItems = [
    {
      icon: <BsFolderPlus size={17} strokeWidth={0.3} />,
      text: t("newFolder"),
      permission: permissions.create,
      disabled: !writePermissions.create,
      onClick: () => triggerAction.show("createFolder"),
    },
    {
      icon: <MdOutlineFileUpload size={18} />,
      text: t("upload"),
      permission: permissions.upload,
      disabled: !writePermissions.upload,
      onClick: () => triggerAction.show("uploadFile"),
    },
    {
      icon: <FaRegPaste size={18} />,
      text: t("paste"),
      permission: !!clipBoard,
      disabled: !canPasteHere,
      onClick: handleFilePasting,
    },
  ];

  const toolbarRightItems = [
    {
      icon: activeLayout === "grid" ? <BsGridFill size={16} /> : <FaListUl size={16} />,
      title: t("changeView"),
      onClick: () => setShowToggleViewMenu((prev) => !prev),
    },
    {
      icon: <FiRefreshCw size={16} />,
      title: t("refresh"),
      onClick: () => {
        validateApiCallback(onRefresh, "onRefresh");
        setClipBoard(null);
      },
    },
  ];

  function handleFilePasting() {
    if (!canPasteHere) return;
    handlePasting(currentFolder);
  }

  const handleDownloadItems = () => {
    handleDownload();
    setSelectedFiles([]);
  };

  // Selected File/Folder Actions
  if (selectedFiles.length > 0) {
    return (
      <div className="toolbar file-selected">
        <div className="file-action-container">
          <div>
            {permissions.move && (
              <button
                className="item-action file-action"
                data-testid="toolbar-cut"
                disabled={!writePermissions.move}
                onClick={() => handleCutCopy(true)}
              >
                <BsScissors size={18} />
                <span>{t("cut")}</span>
              </button>
            )}
            {permissions.copy && (
              <button
                className="item-action file-action"
                data-testid="toolbar-copy"
                onClick={() => handleCutCopy(false)}
              >
                <BsCopy strokeWidth={0.1} size={17} />
                <span>{t("copy")}</span>
              </button>
            )}
            {clipBoard?.files?.length > 0 && (
              <button
                className="item-action file-action"
                data-testid="toolbar-paste"
                onClick={handleFilePasting}
                disabled={!canPasteHere}
              >
                <FaRegPaste size={18} />
                <span>{t("paste")}</span>
              </button>
            )}
            {selectedFiles.length === 1 && permissions.rename && (
              <button
                className="item-action file-action"
                data-testid="toolbar-rename"
                disabled={!writePermissions.rename}
                onClick={() => triggerAction.show("rename")}
              >
                <BiRename size={19} />
                <span>{t("rename")}</span>
              </button>
            )}
            {permissions.download && (
              <button
                className="item-action file-action"
                data-testid="toolbar-download"
                onClick={handleDownloadItems}
              >
                <MdOutlineFileDownload size={19} />
                <span>{t("download")}</span>
              </button>
            )}
            {permissions.delete && (
              <button
                className="item-action file-action"
                data-testid="toolbar-delete"
                disabled={!writePermissions.delete}
                onClick={() => triggerAction.show("delete")}
              >
                <MdOutlineDelete size={19} />
                <span>{t("delete")}</span>
              </button>
            )}
          </div>
          <button
            className="item-action file-action"
            title={t("clearSelection")}
            data-testid="toolbar-clear-selection"
            onClick={() => setSelectedFiles([])}
          >
            <span>
              {selectedFiles.length}{" "}
              {t(selectedFiles.length > 1 ? "itemsSelected" : "itemSelected")}
            </span>
            <MdClear size={18} />
          </button>
        </div>
      </div>
    );
  }
  //

  return (
    <div className="toolbar">
      <div className="fm-toolbar">
        <div>
          {sourceOptions.length > 0 && (
            <div className="source-control">
              <select
                aria-label={t("source")}
                data-testid="source-picker"
                value={activeSourceId}
                onChange={handleSourceChange}
              >
                {sourceOptions.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.label}
                  </option>
                ))}
              </select>
              <span
                className={`source-mode ${isCurrentLocationReadOnly ? "read-only" : "read-write"}`}
                data-testid="source-mode"
                title={selectedSource?.error || selectedSource?.status}
              >
                {isCurrentLocationReadOnly ? t("readOnly") : t("readWrite")}
              </span>
            </div>
          )}
          {toolbarLeftItems
            .filter((item) => item.permission)
            .map((item, index) => (
              <button
                className="item-action"
                key={index}
                disabled={item.disabled}
                data-testid={
                  item.text === t("newFolder")
                    ? "toolbar-new-folder"
                    : item.text === t("upload")
                      ? "toolbar-upload"
                      : item.text === t("paste")
                        ? "toolbar-paste"
                        : undefined
                }
                onClick={item.onClick}
              >
                {item.icon}
                <span>{item.text}</span>
              </button>
            ))}
        </div>
        <div>
          {toolbarRightItems.map((item, index) => (
            <div key={index} className="toolbar-left-items">
              <button className="item-action icon-only" title={item.title} onClick={item.onClick}>
                {item.icon}
              </button>
              {index !== toolbarRightItems.length - 1 && <div className="item-separator"></div>}
            </div>
          ))}

          {showToggleViewMenu && (
            <LayoutToggler
              setShowToggleViewMenu={setShowToggleViewMenu}
              onLayoutChange={onLayoutChange}
            />
          )}
        </div>
      </div>
    </div>
  );
};

Toolbar.displayName = "Toolbar";

export default Toolbar;
