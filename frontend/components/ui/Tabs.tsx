import React, { createContext } from "react"

interface TabsContextValue {
  selectedKey: string
  onSelectionChange: (key: string) => void
}

const TabsContext = createContext<TabsContextValue | null>(null)

export interface TabsProps {
  selectedKey: string
  onSelectionChange: (key: string) => void
  children: React.ReactNode
  variant?: string
  classNames?: {
    base?: string
    tabList?: string
    cursor?: string
    tab?: string
    panel?: string
  }
}

export function Tabs({ selectedKey, onSelectionChange, children, classNames = {} }: TabsProps) {
  const tabs = React.Children.toArray(children).filter((child): child is React.ReactElement =>
    React.isValidElement(child),
  )

  return (
    <TabsContext.Provider value={{ selectedKey, onSelectionChange }}>
      <div className={classNames.base}>
        <div className={`flex ${classNames.tabList || ""}`}>
          {tabs.map((tab, index) => {
            const tabKey = tab.key?.toString().replace(/^\.\$/, "") || `tab-${index}`
            const isSelected = selectedKey === tabKey
            return (
              <button
                key={tabKey}
                onClick={() => onSelectionChange(tabKey)}
                className={`pb-1 text-sm transition-colors relative cursor-pointer ${isSelected ? "text-default-700" : "text-default-500 hover:text-default-700"} ${classNames.tab || ""}`}
              >
                {(tab.props as { title: string }).title}
                {isSelected && (
                  <div
                    className={`absolute bottom-0 left-1/2 -translate-x-1/2 w-3/4 h-[2px] bg-default-700 rounded-t-sm ${classNames.cursor || ""}`}
                  />
                )}
              </button>
            )
          })}
        </div>
        <div className={classNames.panel}>
          {tabs.find((tab, index) => {
            const tabKey = tab.key?.toString().replace(/^\.\$/, "") || `tab-${index}`
            return selectedKey === tabKey
          })}
        </div>
      </div>
    </TabsContext.Provider>
  )
}

export interface TabProps {
  title: string
  children: React.ReactNode
  className?: string
}

export function Tab({ children, className = "" }: TabProps) {
  return <div className={className}>{children}</div>
}
