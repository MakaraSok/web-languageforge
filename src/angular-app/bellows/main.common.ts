import 'angular';
import 'angular-ui-bootstrap';
import 'angular-route';
import 'angular-sortable-view';
import 'angular-zxcvbn';
import 'angular-translate';
import 'angular-translate-loader-static-files';
import 'angular-truncate-2';
import 'angular-ui-router';
import 'angular-ui-validate';

import 'ng-file-upload/dist/ng-file-upload-all.js';
import 'soundmanager2';

import './polyfills.browser';

// these are imported here to ensure JS files can use them
import './apps/activity/activity-app.module'
import './apps/changepassword/change-password-app.module';
import './apps/projects/projects-app.module';
import './apps/public/forgot_password/forgot-password-app.module'
import './apps/public/login/login-app.module';
import './apps/public/reset_password/reset-password-app.module'
import './apps/public/signup/signup-app.module'
import './apps/siteadmin/site-admin-app.module';
import './apps/usermanagement/user-management-app.module';
import './apps/userprofile/user-profile-app.module';
import './core/core.module';
import './shared/pui-utils.module';
