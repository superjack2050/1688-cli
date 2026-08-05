import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { getApi, AccountData } from '../../services/api';

interface Props {
  accounts: AccountData;
  activeProfile: string;
  open: boolean;
  onClose: () => void;
  onAccountsChanged: () => void;
  onProfileChange: (profile: string) => void;
}

const statusLabel: Record<string, string> = { logged_in: '已登录', not_logged_in: '未登录', login_opened: '待验证', verifying: '验证中', login_failed: '登录失败', busy: '占用中', profile_busy: '占用中', risk_control: '风控中', unknown: '未知' };
const statusColor: Record<string, string> = { logged_in: '#16a34a', not_logged_in: '#dc2626', login_opened: '#2563eb', verifying: '#2563eb', login_failed: '#dc2626', busy: '#d97706', profile_busy: '#d97706', risk_control: '#ea580c', unknown: '#888' };

export default function AccountSettingsModal({ accounts, activeProfile, open, onClose, onAccountsChanged, onProfileChange }: Props) {
  const [msg, setMsg] = useState('');
  const [editingProfile, setEditingProfile] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [addAlias, setAddAlias] = useState('');
  const [addProfile, setAddProfile] = useState('');
  const [addNote, setAddNote] = useState('');
  const [addSaving, setAddSaving] = useState(false);
  const api = getApi();

  const handleLoginBrowser = async (profile: string) => {
    setMsg(`正在为 ${profile} 打开登录浏览器...`);
    try {
      await api.accounts.loginBrowser(profile);
      setMsg(`已为 ${profile} 打开登录浏览器，待验证。请完成登录后点击刷新。`);
    } catch (e) { setMsg((e as Error).message); }
  };

  const handleRefreshOne = async (profile: string) => {
    setMsg(`正在验证 ${profile}...`);
    try { await api.accounts.refreshStatus(profile); await onAccountsChanged(); setMsg(`${profile} 已更新。`); }
    catch (e) { setMsg((e as Error).message); }
  };

  const handleRefreshAll = async () => {
    setMsg('正在验证全部账号...');
    for (const a of accounts.accounts) { try { await api.accounts.refreshStatus(a.profile); await new Promise((r) => setTimeout(r, 400)); } catch {} }
    await onAccountsChanged(); setMsg('全部账号状态已更新。');
  };

  const handleLoginAllBrowser = async () => {
    const profiles = accounts.accounts.map((a) => a.profile).filter(Boolean).slice(0, 3);
    try { const r = await api.accounts.loginManyBrowser(profiles); setMsg(`已打开 ${r.openedCount} 个登录浏览器。`); }
    catch (e) { setMsg((e as Error).message); }
  };

  const startEdit = (profile: string, currentAlias: string) => {
    setEditingProfile(profile);
    setEditValue(currentAlias || profile);
  };

  const saveEdit = async (profile: string) => {
    const val = editValue.trim();
    if (!val) { setMsg('备注名不能为空'); return; }
    try {
      await api.accounts.update(profile, { alias: val });
      setEditingProfile(null);
      await onAccountsChanged();
      setMsg('备注名已保存。');
    } catch (e) { setMsg((e as Error).message); }
  };

  const openAddForm = async () => {
    setEditingProfile(null);
    setAddAlias('');
    setAddNote('');
    setAddSaving(false);
    setMsg('');
    try { setAddProfile(await api.accounts.suggestProfileName()); } catch { setAddProfile(''); }
    setShowAddForm(true);
  };

  const handleAddSave = async () => {
    if (!addAlias.trim()) { setMsg('账号备注名不能为空'); return; }
    if (!addProfile.trim()) { setMsg('Profile ID 不能为空'); return; }
    setAddSaving(true);
    setMsg('正在创建账号...');
    try {
      await api.accounts.add({ profile: addProfile.trim(), alias: addAlias.trim(), note: addNote.trim() });
      setShowAddForm(false);
      await onAccountsChanged();
      setMsg(`账号 ${addAlias.trim()} 已创建，正在打开登录浏览器...`);
      await handleLoginBrowser(addProfile.trim());
    } catch (e) { setMsg((e as Error).message); }
    finally { setAddSaving(false); }
  };

  if (!open) return null;

  return createPortal(
    <div className="history-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="history-modal" style={{ width: 'min(860px, calc(100vw - 64px))' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700 }}>1688 账号管理</h3>
          <button className="glass-btn-ghost" onClick={onClose}>关闭</button>
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          <button className="glass-btn-secondary" onClick={openAddForm} style={{ fontSize: 12 }}>新增账号</button>
          <button className="glass-btn-secondary" onClick={handleLoginAllBrowser} style={{ fontSize: 12 }}>全部打开登录浏览器</button>
          <button className="glass-btn-secondary" onClick={handleRefreshAll} style={{ fontSize: 12 }}>全部刷新状态</button>
        </div>

        {msg && <p className="alert info" style={{ fontSize: 12 }}>{msg}</p>}

        {/* Inline add-account form */}
        {showAddForm && (
          <div className="history-row" style={{ padding: '14px', marginBottom: 12, border: '1px solid var(--accent)', borderRadius: 8, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 140 }}>
              <span style={{ fontSize: 11, color: '#888' }}>账号备注名 *</span>
              <input className="glass-input" style={{ width: 150 }} value={addAlias} onChange={(e) => setAddAlias(e.target.value)} placeholder="例如：张三-主采集号" autoFocus />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 120 }}>
              <span style={{ fontSize: 11, color: '#888' }}>Profile ID *</span>
              <input className="glass-input" style={{ width: 140 }} value={addProfile} onChange={(e) => setAddProfile(e.target.value)} placeholder="自动生成" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 120 }}>
              <span style={{ fontSize: 11, color: '#888' }}>备注</span>
              <input className="glass-input" style={{ width: 140 }} value={addNote} onChange={(e) => setAddNote(e.target.value)} placeholder="选填" />
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button className="glass-btn-primary" style={{ fontSize: 12, padding: '5px 14px' }} onClick={handleAddSave} disabled={addSaving}>
                {addSaving ? '保存中...' : '保存并登录'}
              </button>
              <button className="glass-btn-ghost" style={{ fontSize: 12, padding: '5px 10px' }} onClick={() => setShowAddForm(false)}>取消</button>
            </div>
          </div>
        )}

        <div style={{ maxHeight: '60vh', overflowY: 'auto', paddingRight: 4 }}>
          {accounts.accounts.map((a) => (
            <div key={a.profile} className="history-row" style={{ gridTemplateColumns: '1fr auto', cursor: 'default', fontSize: 13, padding: '12px 14px', marginBottom: 8, gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                {editingProfile === a.profile ? (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input className="glass-input" style={{ width: 160 }} value={editValue} onChange={(e) => setEditValue(e.target.value)} autoFocus />
                    <button className="glass-btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => saveEdit(a.profile)}>保存</button>
                    <button className="glass-btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => setEditingProfile(null)}>取消</button>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <strong>{a.alias || a.profile}</strong>
                      {a.alias && <span style={{ color: '#888', fontSize: 10, fontWeight: 400 }}>{a.profile}</span>}
                      {a.profile === activeProfile && <span className="status-badge">当前</span>}
                    </div>
                    {a.note && <span style={{ display: 'block', fontSize: 11, color: '#888', marginTop: 2 }}>{a.note}</span>}
                  </>
                )}
                <span style={{ color: statusColor[a.status] || '#888', fontSize: 11, fontWeight: 600, marginTop: 2, display: 'inline-block' }}>
                  {statusLabel[a.status] || '未知'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {a.profile !== activeProfile && (
                  <button className="account-action-btn secondary" onClick={() => onProfileChange(a.profile)}>切换</button>
                )}
                <button className="account-action-btn primary" onClick={() => handleLoginBrowser(a.profile)}>登录</button>
                <button className="account-action-btn secondary" onClick={() => handleRefreshOne(a.profile)}>刷新</button>
                {editingProfile !== a.profile && (
                  <button className="account-action-btn secondary" onClick={() => startEdit(a.profile, a.alias || '')}>编辑</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
