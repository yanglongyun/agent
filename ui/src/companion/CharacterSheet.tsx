// 创建与编辑角色。创建时可以先写一句想法，让模型补全人设；创建后自动生成头像和封面。
import { useState } from "react";
import { useNavigate } from "react-router";
import { Icon } from "../icons/Icon";
import { Sheet } from "../overlay/Sheet";
import { toast } from "../overlay/toast";
import { useThread } from "../thread/store";
import {
  createCharacter,
  deleteCharacter,
  draftCharacter,
  paintPortrait,
  updateCharacter,
  useCompanion,
} from "./store";
import type { Character } from "./types";

function preferredModel(models: Array<{ id: string; name: string; model: string }>) {
  const sonnet = models.find((model) => /sonnet/i.test(model.name + model.model));
  return sonnet?.id ?? models[0]?.id ?? "";
}

export function CharacterSheet({
  character,
  onClose,
}: {
  character?: Character;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const models = useThread((state) => state.status?.models) ?? [];
  const painting = useCompanion((state) => (character ? state.painting[character.id] : undefined));
  const [idea, setIdea] = useState("");
  const [name, setName] = useState(character?.name ?? "");
  const [tagline, setTagline] = useState(character?.tagline ?? "");
  const [persona, setPersona] = useState(character?.persona ?? "");
  const [appearance, setAppearance] = useState(character?.appearance ?? "");
  const [memory, setMemory] = useState(character?.memory ?? "");
  const [modelId, setModelId] = useState(character?.model_id ?? preferredModel(models));
  const [posting, setPosting] = useState(character?.posting ?? true);
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function draft() {
    if (!modelId) {
      setError("请先在设置中添加模型");
      return;
    }
    setDrafting(true);
    setError("");
    try {
      const result = await draftCharacter(modelId, idea.trim());
      setName(result.name);
      setTagline(result.tagline);
      setPersona(result.persona);
      setAppearance(result.appearance);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "生成失败");
    } finally {
      setDrafting(false);
    }
  }

  async function save() {
    if (!name.trim() || !persona.trim()) {
      setError("名字和人设不能为空");
      return;
    }
    if (!modelId) {
      setError("请选择模型");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (character) {
        await updateCharacter(character.id, {
          name,
          tagline,
          persona,
          appearance,
          memory,
          model_id: modelId,
          posting,
        });
        toast("已保存");
        onClose();
        return;
      }
      const created = await createCharacter({
        name,
        tagline,
        persona,
        appearance,
        model_id: modelId,
        posting,
      });
      onClose();
      navigate(`/characters/${created.id}`);
      if (appearance.trim()) {
        // 先有头像，封面随后；两张图都在后台生成，界面上会显示进度。
        void paintPortrait(created.id, "avatar").then(() => paintPortrait(created.id, "cover"));
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!character) {
      return;
    }
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      await deleteCharacter(character.id);
      onClose();
      navigate("/characters");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "删除失败");
    }
  }

  const busy = drafting || saving;

  return (
    <Sheet
      title={character ? `${character.name} 的资料` : "创建角色"}
      className="wide cp-sheet"
      onClose={onClose}
      footer={
        <>
          {character && (
            <button
              type="button"
              className={`btn ${confirmDelete ? "btn-danger" : "btn-danger-quiet"}`}
              onClick={() => void remove()}
            >
              {confirmDelete ? "确认删除全部记录" : "删除角色"}
            </button>
          )}
          <span className="grow" />
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-accent"
            disabled={busy}
            onClick={() => void save()}
          >
            {saving && <Icon name="loading" size={15} className="spin" />}
            {character ? "保存" : "创建"}
          </button>
        </>
      }
    >
      {!character && (
        <div className="cp-idea">
          <div className="cp-idea-head">
            <Icon name="wand" size={16} />
            <span>一句话描述你想要的她，剩下的交给模型</span>
          </div>
          <textarea
            className="field-input"
            rows={2}
            data-autofocus
            value={idea}
            placeholder="例如：在杭州读研的女生，学插画，养了一只橘猫，温柔但有点小迷糊"
            onChange={(event) => setIdea(event.target.value)}
          />
          <button
            type="button"
            className="btn btn-quiet sm"
            disabled={busy}
            onClick={() => void draft()}
          >
            {drafting ? (
              <Icon name="loading" size={14} className="spin" />
            ) : (
              <Icon name="spark" size={14} />
            )}
            {drafting ? "正在构思…" : name ? "重新构思" : "帮我构思"}
          </button>
        </div>
      )}

      {character && (
        <div className="cp-sheet-portraits">
          <button
            type="button"
            className="btn btn-quiet sm"
            disabled={Boolean(painting)}
            onClick={() => void paintPortrait(character.id, "avatar")}
          >
            <Icon
              name={painting === "avatar" ? "loading" : "refresh"}
              size={14}
              className={painting === "avatar" ? "spin" : undefined}
            />
            {painting === "avatar" ? "正在生成头像…" : "重新生成头像"}
          </button>
          <button
            type="button"
            className="btn btn-quiet sm"
            disabled={Boolean(painting)}
            onClick={() => void paintPortrait(character.id, "cover")}
          >
            <Icon
              name={painting === "cover" ? "loading" : "image"}
              size={14}
              className={painting === "cover" ? "spin" : undefined}
            />
            {painting === "cover" ? "正在生成封面…" : "重新生成封面"}
          </button>
          <span className="field-note">按当前已保存的外貌描述生成。</span>
        </div>
      )}

      <div className="cp-form">
        <div className="cp-form-row">
          <label className="field">
            名字
            <input
              className="field-input"
              value={name}
              maxLength={40}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="field">
            一句话介绍
            <input
              className="field-input"
              value={tagline}
              maxLength={60}
              onChange={(event) => setTagline(event.target.value)}
            />
          </label>
        </div>
        <label className="field">
          人设
          <textarea
            className="field-input"
            rows={8}
            value={persona}
            placeholder="她是谁、在哪里生活、性格和说话方式、日常作息、喜欢什么、和你是什么关系……"
            onChange={(event) => setPersona(event.target.value)}
          />
        </label>
        <label className="field">
          外貌
          <textarea
            className="field-input"
            rows={3}
            value={appearance}
            placeholder="年龄感、脸型、发型、常见穿搭。生成头像、自拍和动态照片时使用。"
            onChange={(event) => setAppearance(event.target.value)}
          />
        </label>
        {character && (
          <label className="field">
            她记得的事
            <textarea
              className="field-input"
              rows={4}
              value={memory}
              placeholder="聊天时她会自己记下关于你的事，也可以在这里修改。"
              onChange={(event) => setMemory(event.target.value)}
            />
          </label>
        )}
        <div className="cp-form-row">
          <label className="field">
            模型
            <select
              className="field-input"
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
            >
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          </label>
          <label className="cp-switch-field">
            <span>
              <span className="cp-switch-label">自己发动态</span>
              <span className="field-note">每天几条，夜里不发</span>
            </span>
            <input
              type="checkbox"
              className="switch"
              checked={posting}
              onChange={(event) => setPosting(event.target.checked)}
            />
          </label>
        </div>
      </div>
      {error && <p className="sheet-error">{error}</p>}
    </Sheet>
  );
}
