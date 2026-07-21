import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useFiles } from "./FilesContext";
import sortFiles from "../utils/sortFiles";

const FileNavigationContext = createContext();
const LOCAL_SOURCE_ID = "local-data-root";
const WORKSPACE_SOURCE_ID = "service-lasso-workspaces";

export const FileNavigationProvider = ({ children, initialPath, onFolderChange, sources }) => {
  const { files } = useFiles();
  const isMountRef = useRef(false);
  const deepLinkRef = useRef(readDeepLink());
  const sourceOptions = useMemo(() => normalizeSourceOptions(sources, files), [sources, files]);
  const [activeSourceId, setActiveSourceIdState] = useState(
    () => deepLinkRef.current.source || sourceOptions[0]?.id || LOCAL_SOURCE_ID,
  );
  const [currentPath, setCurrentPath] = useState("");
  const [currentFolder, setCurrentFolder] = useState(null);
  const [currentPathFiles, setCurrentPathFiles] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: "name", direction: "asc" });
  const selectedSource = sourceOptions.find((source) => source.id === activeSourceId) ?? sourceOptions[0];
  const activeFiles = useMemo(
    () => files.filter((file) => belongsToSource(file, selectedSource?.id)),
    [files, selectedSource?.id],
  );
  const isWorkspaceSource = selectedSource?.id === WORKSPACE_SOURCE_ID;
  const isCurrentLocationReadOnly = Boolean(currentFolder?.readOnly);
  const canMutateInCurrentLocation = isWorkspaceSource
    ? Boolean(currentFolder?.rootId && !currentFolder?.readOnly)
    : !isCurrentLocationReadOnly;

  useEffect(() => {
    if (Array.isArray(activeFiles) && activeFiles.length > 0) {
      setCurrentPathFiles(() => {
        const currPathFiles = activeFiles.filter((file) => file.path === `${currentPath}/${file.name}`);
        return sortFiles(currPathFiles, sortConfig.key, sortConfig.direction);
      });

      setCurrentFolder(() => {
        return activeFiles.find((file) => file.path === currentPath) ?? null;
      });
    } else {
      setCurrentPathFiles([]);
      setCurrentFolder(null);
    }
  }, [activeFiles, currentPath, sortConfig]);

  useEffect(() => {
    if (!isMountRef.current && Array.isArray(activeFiles) && activeFiles.length > 0) {
      const activePath = resolveInitialPath(activeFiles, initialPath, deepLinkRef.current);
      setCurrentPath(activePath);
      isMountRef.current = true;
    }
  }, [activeFiles, initialPath]);

  useEffect(() => {
    if (sourceOptions.some((source) => source.id === activeSourceId)) {
      return;
    }
    if (deepLinkRef.current.source && activeSourceId === deepLinkRef.current.source) {
      return;
    }
    if (sourceOptions.length > 0) {
      setActiveSourceIdState(sourceOptions[0]?.id || LOCAL_SOURCE_ID);
    }
  }, [activeSourceId, sourceOptions]);

  const setActiveSourceId = (sourceId) => {
    setActiveSourceIdState(sourceId);
    setCurrentPath("");
    onFolderChange?.("");
  };

  return (
    <FileNavigationContext.Provider
      value={{
        sourceOptions,
        selectedSource,
        activeSourceId,
        setActiveSourceId,
        activeFiles,
        currentPath,
        setCurrentPath,
        currentFolder,
        setCurrentFolder,
        currentPathFiles,
        setCurrentPathFiles,
        sortConfig,
        setSortConfig,
        onFolderChange,
        isCurrentLocationReadOnly,
        canMutateInCurrentLocation,
      }}
    >
      {children}
    </FileNavigationContext.Provider>
  );
};

export const useFileNavigation = () => useContext(FileNavigationContext);

function normalizeSourceOptions(sources, files = []) {
  const options = [];
  const pushUnique = (option) => {
    if (!option?.id || options.some((existing) => existing.id === option.id)) return;
    options.push(option);
  };

  if (Array.isArray(sources?.sources)) {
    sources.sources.forEach((source) =>
      pushUnique({
        id: source.sourceId || source.id || source.provider,
        label: source.label || source.name || labelForSource(source.sourceId || source.id || source.provider),
        status: source.status || "ok",
        error: source.error,
      }),
    );
  }

  if (sources?.provider) {
    pushUnique({
      id: sources.provider,
      label: labelForSource(sources.provider),
      status: sources.status || "ok",
      error: sources.error,
    });
  }

  for (const file of files) {
    pushUnique({
      id: file.sourceId || LOCAL_SOURCE_ID,
      label: labelForSource(file.sourceId || LOCAL_SOURCE_ID),
      status: "ok",
    });
  }

  if (options.length === 0) {
    pushUnique({ id: LOCAL_SOURCE_ID, label: labelForSource(LOCAL_SOURCE_ID), status: "ok" });
  }

  return options;
}

function belongsToSource(file, sourceId = LOCAL_SOURCE_ID) {
  if (sourceId === LOCAL_SOURCE_ID) {
    return !file.sourceId || file.sourceId === LOCAL_SOURCE_ID;
  }

  return file.sourceId === sourceId;
}

function resolveInitialPath(files, initialPath, deepLink) {
  const linkedPath = resolveDeepLinkPath(files, deepLink);
  if (linkedPath) {
    return linkedPath;
  }

  return files.some((file) => file.isDirectory && file.path === initialPath) ? initialPath : "";
}

function resolveDeepLinkPath(files, deepLink) {
  if (deepLink.source !== WORKSPACE_SOURCE_ID || !deepLink.service || !deepLink.root) {
    return "";
  }

  const root = files.find(
    (file) =>
      file.isDirectory &&
      file.sourceId === WORKSPACE_SOURCE_ID &&
      file.serviceId === deepLink.service &&
      file.rootId === deepLink.root &&
      file.virtual,
  );
  if (!root) {
    return "";
  }

  const nestedPath = normalizeQueryPath(deepLink.path);
  if (!nestedPath) {
    return root.path;
  }

  const candidate = `${root.path}/${nestedPath}`;
  return files.some((file) => file.isDirectory && file.path === candidate) ? candidate : root.path;
}

function normalizeQueryPath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function readDeepLink() {
  if (typeof window === "undefined") {
    return {};
  }

  const params = new URLSearchParams(window.location.search);
  return {
    source: params.get("source") || "",
    service: params.get("service") || "",
    root: params.get("root") || "",
    path: params.get("path") || "",
  };
}

function labelForSource(sourceId) {
  if (sourceId === WORKSPACE_SOURCE_ID) {
    return "Service workspaces";
  }
  if (sourceId === LOCAL_SOURCE_ID) {
    return "Local files";
  }
  return sourceId || "Files";
}
