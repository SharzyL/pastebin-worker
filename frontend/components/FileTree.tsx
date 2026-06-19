import { useMemo, useState } from "react"
import { formatSize } from "../utils/utils.js"
import { ChevronDownIcon, FileIcon, FolderIcon } from "./icons.js"
import { tst } from "../utils/overrides.js"
import { itemCountLabel } from "../../shared/format.js"

export interface FileTreeEntry {
  name: string
  sizeBytes: number
}

interface FileTreeNode {
  name: string
  path: string
  type: "file" | "folder"
  sizeBytes: number
  children: FileTreeNode[]
}

interface MutableFileTreeNode {
  name: string
  path: string
  type: "file" | "folder"
  sizeBytes: number
  children: Map<string, MutableFileTreeNode>
}

interface FileTreeProps {
  files: FileTreeEntry[]
  className?: string
  compact?: boolean
}

function normalizedFilePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "")
}

function childKey(type: FileTreeNode["type"], name: string): string {
  return `${type}:${name}`
}

function toReadonlyNode(node: MutableFileTreeNode): FileTreeNode {
  const children = Array.from(node.children.values())
    .map(toReadonlyNode)
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  return { ...node, children }
}

function buildFileTree(files: FileTreeEntry[]): FileTreeNode[] {
  const root = new Map<string, MutableFileTreeNode>()

  function getOrCreateFolder(
    siblings: Map<string, MutableFileTreeNode>,
    name: string,
    path: string,
  ): MutableFileTreeNode {
    const key = childKey("folder", name)
    const existing = siblings.get(key)
    if (existing) return existing

    const node: MutableFileTreeNode = {
      name,
      path,
      type: "folder",
      sizeBytes: 0,
      children: new Map(),
    }
    siblings.set(key, node)
    return node
  }

  for (const file of files) {
    const path = normalizedFilePath(file.name)
    if (!path) continue

    const isFolder = path.endsWith("/")
    const parts = path.split("/").filter(Boolean)
    let siblings = root
    let currentPath = ""

    parts.forEach((part, index) => {
      const isLast = index === parts.length - 1
      currentPath += `${part}${isLast && !isFolder ? "" : "/"}`

      if (isLast && !isFolder) {
        siblings.set(childKey("file", part), {
          name: part,
          path: currentPath,
          type: "file",
          sizeBytes: file.sizeBytes,
          children: new Map(),
        })
        return
      }

      const folder = getOrCreateFolder(siblings, part, currentPath)
      siblings = folder.children
    })
  }

  return Array.from(root.values())
    .map(toReadonlyNode)
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

function FolderMeta({ node }: { node: FileTreeNode }) {
  if (node.children.length === 0) return <span>0 item</span>
  return <span>{itemCountLabel(node.children.length)}</span>
}

function FileTreeRows({
  nodes,
  depth,
  expandedPaths,
  toggleExpanded,
  compact,
}: {
  nodes: FileTreeNode[]
  depth: number
  expandedPaths: Set<string>
  toggleExpanded: (path: string) => void
  compact: boolean
}) {
  return (
    <>
      {nodes.map((node) => {
        const isExpanded = expandedPaths.has(node.path)
        const indent = { paddingLeft: `${depth * (compact ? 0.5 : 0.8)}rem` }

        if (node.type === "folder") {
          return (
            <div key={`folder-${node.path}`}>
              <button
                type="button"
                className={
                  `flex w-full cursor-pointer items-center rounded px-1 py-1 text-left hover:bg-default-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-default-400 ${tst} ` +
                  (compact ? "justify-between gap-1.5" : "justify-between gap-3")
                }
                style={indent}
                aria-expanded={isExpanded}
                onClick={() => toggleExpanded(node.path)}
              >
                <span className="flex min-w-0 items-center">
                  <span className="flex shrink-0 items-center gap-0">
                    <ChevronDownIcon className={`size-4 shrink-0 ${isExpanded ? "" : "-rotate-90"}`} />
                    <FolderIcon className="size-4 shrink-0 text-foreground-500" />
                  </span>
                  <span className="ml-1 truncate" title={node.path}>
                    {node.name}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-foreground-500">
                  <FolderMeta node={node} />
                </span>
              </button>
              {isExpanded && node.children.length > 0 && (
                <FileTreeRows
                  nodes={node.children}
                  depth={depth + 1}
                  expandedPaths={expandedPaths}
                  toggleExpanded={toggleExpanded}
                  compact={compact}
                />
              )}
            </div>
          )
        }

        return (
          <div
            key={`file-${node.path}`}
            className="flex items-center justify-between gap-3 rounded px-1 py-1"
            style={indent}
          >
            <span className="flex min-w-0 items-center">
              <span className="flex shrink-0 items-center gap-0">
                <span className="size-4 shrink-0" />
                <FileIcon className="size-4 shrink-0 text-foreground-500" />
              </span>
              <span className="ml-1 truncate" title={node.path}>
                {node.name}
              </span>
            </span>
            <span className="shrink-0 text-xs text-foreground-500">{formatSize(node.sizeBytes)}</span>
          </div>
        )
      })}
    </>
  )
}

export function FileTree({ files, className = "", compact = false }: FileTreeProps) {
  const nodes = useMemo(() => buildFileTree(files), [files])
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set())

  function toggleExpanded(path: string) {
    setExpandedPaths((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  return (
    <div className={`text-sm text-foreground-600 ${className}`}>
      <FileTreeRows
        nodes={nodes}
        depth={0}
        expandedPaths={expandedPaths}
        toggleExpanded={toggleExpanded}
        compact={compact}
      />
    </div>
  )
}
