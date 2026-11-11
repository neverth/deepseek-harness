/** `agentGroupBoard` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'rail.resize': '拖动调整看板宽度，双击恢复默认',
  'action.refresh': '刷新',
  'action.fit': '适应',
  'action.actual': '1:1',
  'action.open': '打开',
  'action.collapse': '收起',
  'action.expand': '展开看板',
} satisfies Record<string, string>

/** The `agentGroupBoard` namespace key union. */
export type AgentGroupBoardKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'rail.resize': 'Drag to resize the board; double-click to reset',
  'action.refresh': 'Refresh',
  'action.fit': 'Fit',
  'action.actual': '1:1',
  'action.open': 'Open',
  'action.collapse': 'Collapse',
  'action.expand': 'Expand board',
} satisfies Record<AgentGroupBoardKey, string>

/** Japanese dictionary, checked complete against the English key set. */
export const ja = {
  'rail.resize': 'ドラッグで看板の幅を調整、ダブルクリックで既定に戻す',
  'action.refresh': '更新',
  'action.fit': 'フィット',
  'action.actual': '1:1',
  'action.open': '開く',
  'action.collapse': '折りたたむ',
  'action.expand': '看板を展開',
} satisfies Record<keyof typeof en, string>

/** Spanish dictionary, checked complete against the English key set. */
export const es = {
  'rail.resize': 'Arrastra para cambiar el ancho del tablero; doble clic para restablecer',
  'action.refresh': 'Actualizar',
  'action.fit': 'Ajustar',
  'action.actual': '1:1',
  'action.open': 'Abrir',
  'action.collapse': 'Contraer',
  'action.expand': 'Expandir tablero',
} satisfies Record<keyof typeof en, string>

/** French dictionary, checked complete against the English key set. */
export const fr = {
  'rail.resize': 'Faites glisser pour redimensionner le tableau ; double-clic pour réinitialiser',
  'action.refresh': 'Actualiser',
  'action.fit': 'Ajuster',
  'action.actual': '1:1',
  'action.open': 'Ouvrir',
  'action.collapse': 'Replier',
  'action.expand': 'Déplier le tableau',
} satisfies Record<keyof typeof en, string>

/** German dictionary, checked complete against the English key set. */
export const de = {
  'rail.resize': 'Ziehen ändert die Brettbreite; Doppelklick setzt sie zurück',
  'action.refresh': 'Aktualisieren',
  'action.fit': 'Anpassen',
  'action.actual': '1:1',
  'action.open': 'Öffnen',
  'action.collapse': 'Einklappen',
  'action.expand': 'Brett ausklappen',
} satisfies Record<keyof typeof en, string>

/** Russian dictionary, checked complete against the English key set. */
export const ru = {
  'rail.resize': 'Перетащите, чтобы изменить ширину доски; двойной щелчок сбрасывает',
  'action.refresh': 'Обновить',
  'action.fit': 'По ширине',
  'action.actual': '1:1',
  'action.open': 'Открыть',
  'action.collapse': 'Свернуть',
  'action.expand': 'Развернуть доску',
} satisfies Record<keyof typeof en, string>

/** Portuguese dictionary, checked complete against the English key set. */
export const pt = {
  'rail.resize': 'Arraste para ajustar a largura do painel; clique duplo restaura',
  'action.refresh': 'Atualizar',
  'action.fit': 'Ajustar',
  'action.actual': '1:1',
  'action.open': 'Abrir',
  'action.collapse': 'Recolher',
  'action.expand': 'Expandir painel',
} satisfies Record<keyof typeof en, string>
