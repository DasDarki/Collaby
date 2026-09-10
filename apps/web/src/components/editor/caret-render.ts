export interface CaretUser {
  name?: string | null;
  color?: string | null;
  userId?: string | null;
}

export function renderCollaborationCaret(user: CaretUser): HTMLElement {
  const color = user.color ?? '#7c9cff';

  const caret = document.createElement('span');
  caret.classList.add('collaboration-carets__caret');
  caret.style.borderColor = color;
  if (user.userId) caret.setAttribute('data-user-id', user.userId);

  const label = document.createElement('div');
  label.classList.add('collaboration-carets__label');
  label.style.backgroundColor = color;
  label.textContent = user.name ?? 'Anonymous';

  caret.append(label);
  return caret;
}
