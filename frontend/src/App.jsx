import { useEffect, useRef, useState } from "react";
import { archiveSelectionAPI } from "./api/archiveAPI";
import { createFolderAPI } from "./api/createFolderAPI";
import { deleteAPI } from "./api/deleteAPI";
import { downloadFile } from "./api/downloadFileAPI";
import { copyItemAPI, moveItemAPI } from "./api/fileTransferAPI";
import { getAllFilesAPI } from "./api/getAllFilesAPI";
import { renameAPI } from "./api/renameAPI";
import "./App.scss";
import FileManager from "./FileManager/FileManager";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api/file-system";
const CONFIG_URL = import.meta.env.VITE_API_CONFIG_URL || "/api/config";
const SOURCES_URL = import.meta.env.VITE_API_SOURCES_URL || "/api/sources";
const FILE_PREVIEW_BASE_URL = import.meta.env.VITE_API_FILES_BASE_URL || "/content";
const DEFAULT_ACCEPTED_FILE_TYPES = ".txt, .png, .jpg, .jpeg, .pdf, .doc, .docx, .exe";
const DEFAULT_MAX_FILE_SIZE = 300 * 1024 * 1024;

function App() {
  const fileUploadConfig = {
    url: `${API_BASE_URL}/upload`,
  };
  const [isLoading, setIsLoading] = useState(false);
  const [files, setFiles] = useState([]);
  const [currentPath, setCurrentPath] = useState("");
  const [sources, setSources] = useState(null);
  const [acceptedFileTypes, setAcceptedFileTypes] = useState(DEFAULT_ACCEPTED_FILE_TYPES);
  const [maxFileSize, setMaxFileSize] = useState(DEFAULT_MAX_FILE_SIZE);
  const isMountRef = useRef(false);

  // Get Files
  const getFiles = async () => {
    setIsLoading(true);
    const response = await getAllFilesAPI();
    if (response.status === 200 && response.data) {
      setFiles(response.data);
    } else {
      console.error(response);
      setFiles([]);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    if (isMountRef.current) return;
    isMountRef.current = true;
    getConfig();
    getSources();
    getFiles();
  }, []);
  //

  const getSources = async () => {
    try {
      const response = await fetch(SOURCES_URL);
      if (!response.ok) return;
      setSources(await response.json());
    } catch (error) {
      console.error(error);
      setSources(null);
    }
  };

  const getConfig = async () => {
    try {
      const response = await fetch(CONFIG_URL);
      if (!response.ok) return;
      const config = await response.json();
      setAcceptedFileTypes(config.acceptedFileTypes || "");
      setMaxFileSize(config.maxUploadBytes || DEFAULT_MAX_FILE_SIZE);
    } catch (error) {
      console.error(error);
    }
  };

  // Create Folder
  const handleCreateFolder = async (name, parentFolder) => {
    setIsLoading(true);
    const response = await createFolderAPI(name, parentFolder?._id);
    if (response.status === 200 || response.status === 201) {
      setFiles((prev) => [...prev, response.data]);
    } else {
      console.error(response);
    }
    setIsLoading(false);
  };
  //

  // File Upload Handlers
  const handleFileUploading = (file, parentFolder) => {
    return { parentId: parentFolder?._id };
  };

  const handleFileUploaded = (response) => {
    const uploadedFile = JSON.parse(response);
    setFiles((prev) => [...prev, uploadedFile]);
  };
  //

  // Rename File/Folder
  const handleRename = async (file, newName) => {
    setIsLoading(true);
    const response = await renameAPI(file._id, newName);
    if (response.status === 200) {
      getFiles();
    } else {
      console.error(response);
    }
    setIsLoading(false);
  };
  //

  // Delete File/Folder
  const handleDelete = async (files) => {
    setIsLoading(true);
    const idsToDelete = files.map((file) => file._id);
    const response = await deleteAPI(idsToDelete);
    if (response.status === 200) {
      getFiles();
    } else {
      console.error(response);
      setIsLoading(false);
    }
  };
  //

  // Paste File/Folder
  const handlePaste = async (copiedItems, destinationFolder, operationType) => {
    setIsLoading(true);
    const copiedItemIds = copiedItems.map((item) => item._id);
    if (operationType === "copy") {
      const response = await copyItemAPI(copiedItemIds, destinationFolder?._id);
    } else {
      const response = await moveItemAPI(copiedItemIds, destinationFolder?._id);
    }
    await getFiles();
  };
  //

  const handleLayoutChange = (layout) => {
    console.log(layout);
  };

  // Refresh Files
  const handleRefresh = () => {
    getSources();
    getFiles();
  };
  //

  const handleFileOpen = (file) => {
    console.log(`Opening file: ${file.name}`);
  };

  const handleError = (error, file) => {
    console.error(error);
  };

  const handleDownload = async (files) => {
    await downloadFile(files);
  };

  const handleArchive = async (files) => {
    return archiveSelectionAPI(files);
  };

  const handleCut = (files) => {
    console.log("Moving Files", files);
  };

  const handleCopy = (files) => {
    console.log("Copied Files", files);
  };

  const handleSelectionChange = (files) => {
    console.log("Selected Files", files);
  };

  return (
    <div className="app">
      <div className="file-manager-container">
        <FileManager
          files={files}
          sources={sources}
          fileUploadConfig={fileUploadConfig}
          isLoading={isLoading}
          onCreateFolder={handleCreateFolder}
          onFileUploading={handleFileUploading}
          onFileUploaded={handleFileUploaded}
          onCut={handleCut}
          onCopy={handleCopy}
          onPaste={handlePaste}
          onRename={handleRename}
          onDownload={handleDownload}
          onArchive={handleArchive}
          onDelete={handleDelete}
          onLayoutChange={handleLayoutChange}
          onRefresh={handleRefresh}
          onFileOpen={handleFileOpen}
          onSelectionChange={handleSelectionChange}
          onError={handleError}
          layout="grid"
          enableFilePreview
          maxFileSize={maxFileSize}
          filePreviewPath={FILE_PREVIEW_BASE_URL}
          acceptedFileTypes={acceptedFileTypes}
          height="100%"
          width="100%"
          initialPath={currentPath}
          onFolderChange={setCurrentPath}
        />
      </div>
    </div>
  );
}

export default App;
