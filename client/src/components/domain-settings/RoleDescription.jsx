import React from 'react';

export function roleDescription(role,platformEnabled=true){
  return ({
    superadmin:'Manages every website and account, platform security, email delivery, sensitive exports and restore approvals. Two-factor authentication is required.',
    admin:platformEnabled?'Manages assigned websites and their Editor and Viewer teams. Can send notifications, manage schedules and website settings, and view reports. Can create independent Admins with a subset of those websites, and edit usernames and passwords or reset their own Editors and Viewers. Cannot edit other Admins or change platform security.':'Manages all websites and users, sends notifications, manages schedules and settings, and views reports.',
    editor:'Creates and sends notifications, manages schedules and website settings, and views reports for assigned websites. Cannot create users or change account access.',
    viewer:'Views dashboards, analytics and reports for assigned websites. Cannot send notifications, change website settings or manage users.',
  })[role]||'';
}
export default function RoleDescription({role,platformEnabled,id}){
  return <p id={id} className="security-role-help">{roleDescription(role,platformEnabled)}</p>;
}
