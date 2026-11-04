"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Button, EmptyState } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";
import { useTranslations } from "next-intl";

interface PluginInfo {
  name: string;
  version: string;
  description?: string;
  author?: string;
  status: string;
  enabled: boolean;
  hooks: string[];
}

export default function PluginsPage() {
  const { addNotification } = useNotificationStore();
  const t = useTranslations("plugins");
  const common = useTranslations("common");
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  // Distinguish "no plugins installed" from "the list could not be loaded". Both used
  // to render the same empty state, so an expired session (401) looked like an empty
  // plugin directory — the one message that must never be ambiguous.
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchPlugins = useCallback(async () => {
    try {
      const res = await fetch("/api/plugins", { cache: "no-store" });
      if (!res.ok) {
        setLoadError(`HTTP ${res.status}`);
        return;
      }
      const data = await res.json();
      setPlugins(data.plugins || []);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await fetchPlugins();
    })();
  }, [fetchPlugins]);

  const handleScan = async () => {
    setScanning(true);
    try {
      const res = await fetch("/api/plugins/scan", { method: "POST" });
      if (res.ok) {
        addNotification({ type: "success", message: t("pluginScanComplete") });
        await fetchPlugins();
      }
    } catch {
      addNotification({ type: "error", message: t("pluginScanFailed") });
    } finally {
      setScanning(false);
    }
  };

  const handleToggle = async (name: string, enable: boolean) => {
    const endpoint = enable ? "activate" : "deactivate";
    try {
      const res = await fetch(`/api/plugins/${name}/${endpoint}`, { method: "POST" });
      if (res.ok) {
        addNotification({
          type: "success",
          message: enable ? t("activated", { name }) : t("deactivated", { name }),
        });
        await fetchPlugins();
      }
    } catch {
      addNotification({
        type: "error",
        message: enable ? t("activateFailed", { name }) : t("deactivateFailed", { name }),
      });
    }
  };

  const handleUninstall = async (name: string) => {
    if (!confirm(t("uninstallConfirm", { name }))) return;
    try {
      const res = await fetch(`/api/plugins/${name}`, { method: "DELETE" });
      if (res.ok) {
        addNotification({ type: "success", message: t("uninstalled", { name }) });
        await fetchPlugins();
      }
    } catch {
      addNotification({ type: "error", message: t("uninstallFailed", { name }) });
    }
  };

  if (loading) {
    return <div className="p-6">{t("loading")}</div>;
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
      </div>

      <div className="flex items-center justify-end">
        <Button onClick={handleScan} disabled={scanning}>
          {scanning ? t("scanning") : t("scanForPlugins")}
        </Button>
      </div>
      {loadError ? (
        <Card className="p-4">
          <p className="text-sm font-semibold text-red-600 dark:text-red-400">
            {common("error")} — {loadError}
          </p>
          <p className="mt-1 text-xs text-gray-500">/api/plugins · {t("noPluginsDescription")}</p>
          <div className="mt-3">
            <Button
              onClick={() => {
                setLoading(true);
                void fetchPlugins();
              }}
            >
              {common("refresh")}
            </Button>
          </div>
        </Card>
      ) : plugins.length === 0 ? (
        <EmptyState title={t("noPlugins")} description={t("noPluginsDescription")} />
      ) : (
        <div className="grid gap-4">
          {plugins.map((plugin) => (
            <Card key={plugin.name} className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">{plugin.name}</h3>
                  <p className="text-sm text-gray-500">
                    v{plugin.version}
                    {plugin.author ? ` by ${plugin.author}` : ""}
                    {plugin.description ? ` — ${plugin.description}` : ""}
                  </p>
                  <div className="mt-1 flex gap-1">
                    {plugin.hooks.map((hook) => (
                      <span
                        key={hook}
                        className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700"
                      >
                        {hook}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant={plugin.enabled ? "secondary" : "primary"}
                    onClick={() => handleToggle(plugin.name, !plugin.enabled)}
                  >
                    {plugin.enabled ? t("deactivate") : t("activate")}
                  </Button>
                  <Button variant="danger" onClick={() => handleUninstall(plugin.name)}>
                    {t("uninstall")}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
