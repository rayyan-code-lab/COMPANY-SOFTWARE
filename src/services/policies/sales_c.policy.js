export const select = (record, user) => {
  if (!user) return false;
  return user.profile === 'Admin_c' || user.profile === 'Manager_c';
};

export const insert = (record, user) => {
  if (!user) return false;
  return user.profile === 'Admin_c' || user.profile === 'Manager_c';
};

export const update = (record, user) => {
  if (!user) return false;
  return user.profile === 'Admin_c' || user.profile === 'Manager_c';
};

export const remove = (record, user) => {
  if (!user) return false;
  return user.profile === 'Admin_c';
};
