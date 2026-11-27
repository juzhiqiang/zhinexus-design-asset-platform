'use client';

import { useEffect, useRef, useState } from 'react';
import { ipPreviewMode, requestComponentPreview, requestPreviewGrant, type PreviewAccessMode, type PreviewGrant } from '../../../lib/preview-client';
import type { ComponentVariantMeta } from '../../../lib/types';

export function ComponentPreview({ componentId, componentName, variant, refresh, access = 'public' }: {
  componentId: string;
  componentName: string;
  variant: ComponentVariantMeta;
  refresh: () => void;
  access?: PreviewAccessMode;
}) {
  const { framework, variantId, variantReleaseId, frameworkName } = variant;
  const [grant, setGrant] = useState<PreviewGrant | null | undefined>(undefined);
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    setGrant(undefined);
    const promise = variantReleaseId
      ? requestPreviewGrant(variantReleaseId, controller.signal, { access })
      : requestComponentPreview(componentId, variantId, framework, controller.signal, { access });
    promise.then((result) => {
      if (!controller.signal.aborted) setGrant(result);
    });
    return () => controller.abort();
  }, [componentId, variantId, variantReleaseId, framework, access]);

  const opaque = grant ? grant.isolation === 'ip-port' : ipPreviewMode;
  const sandbox = opaque ? 'allow-scripts' : 'allow-scripts allow-same-origin';
  const url = grant?.url ?? null;

  const openInNewWindow = async () => {
    if (grant?.isolation !== 'domain' || !request.current) return;
    const { signal } = request.current;
    // Reserve the tab during the click, before awaiting a distinct one-use grant.
    const popup = window.open('about:blank', '_blank');
    if (!popup) return;
    popup.opener = null;
    const windowGrant = await requestPreviewGrant(grant.variantReleaseId, signal, { access });
    if (popup.closed) return;
    if (signal.aborted || windowGrant?.isolation !== 'domain' || new URL(windowGrant.url).origin !== new URL(grant.url).origin) {
      popup.close();
      return;
    }
    const link = popup.document.createElement('a');
    link.href = windowGrant.url;
    link.referrerPolicy = 'no-referrer';
    link.click();
  };

  return (
    <section className="preview-section" aria-label="组件沙箱隔离预览">
      <div className="preview-toolbar">
        <div className="preview-badge-group">
          <span className="live-indicator" title="预览服务状态"></span>
          <strong>{frameworkName} 沙箱交互预览</strong>
          <span className="shield-badge">
            {opaque ? '沙箱安全隔离' : '独立域沙箱安全隔离'} (sandbox {sandbox})
          </span>
          {grant && <span className="tag tag-ready" style={{ fontSize: '10px' }}>已授权 (Grant Active)</span>}
        </div>

        <div className="preview-actions">
          <span style={{ fontSize: '12px', color: '#64748b', alignSelf: 'center' }}>800 × 400</span>
          <button type="button" className="preview-btn" onClick={refresh} title="重新加载预览沙箱">
            刷新预览
          </button>
          {!opaque && grant && (
            <button type="button" className="preview-btn" onClick={openInNewWindow} title="在独立窗口打开预览（第三方 Cookie 阻止时的降级方案）">
              独立窗口 ↗
            </button>
          )}
        </div>
      </div>

      <div className="iframe-container">
        {url ? (
          <iframe
            key={url}
            src={url}
            className="preview-frame"
            sandbox={sandbox}
            referrerPolicy="no-referrer"
            title={`${componentName} (${frameworkName}) 交互预览`}
          />
        ) : (
          <p role="status">
            {grant === undefined
              ? '正在获取预览授权…'
              : access === 'public'
                ? '暂时无法加载预览，请刷新重试。'
                : '暂时无法打开预览，请登录后刷新重试。'}
          </p>
        )}
      </div>
    </section>
  );
}
