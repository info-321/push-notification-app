import React from 'react';
import {render,screen} from '@testing-library/react';
import '@testing-library/jest-dom';
import RoleDescription,{roleDescription} from './RoleDescription';
test('role explanations describe actual scope and do not mention private owners to ordinary roles',()=>{
  for(const role of ['admin','editor','viewer'])expect(roleDescription(role,true)).not.toMatch(/superadmin/i);
  expect(roleDescription('admin',true)).toMatch(/assigned websites/);expect(roleDescription('admin',false)).toMatch(/all websites/);
  expect(roleDescription('viewer')).toMatch(/Cannot send notifications/);expect(roleDescription('superadmin')).toMatch(/Two-factor authentication is required/);
  const {rerender}=render(<RoleDescription role="editor"/>);expect(screen.getByText(/Creates and sends/)).toBeInTheDocument();rerender(<RoleDescription role="viewer"/>);expect(screen.getByText(/Cannot send notifications/)).toBeInTheDocument();
});
