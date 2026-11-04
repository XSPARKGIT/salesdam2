import { useState, useEffect, useRef } from 'react';
import { Camera, AlertCircle, Check } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import api from '../../services/api';
import Layout from '../../layout/Layout';
import MfaSettings from './MfaSettings';
import styles from './Profile.module.css';

const Profile = () => {
  const { user, fetchMe } = useAuth();
  const [activeTab, setActiveTab] = useState('personal');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  // Personal Information Tab
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    username: '',
    gender: '',
    department: '',
    email: '',
    phone: '',
    bio: '',
  });

  // Security Tab
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false,
  });
  const [passwordVerified, setPasswordVerified] = useState(false);
  const [verifyingPassword, setVerifyingPassword] = useState(false);

  useEffect(() => {
    if (user) {
      setFormData({
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        username: user.username || '',
        gender: user.gender || '',
        department: user.department || '',
        email: user.email || '',
        phone: user.phone || '',
        bio: user.bio || '',
      });
    }
  }, [user]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setError('');
  };

  const handlePasswordChange = (e) => {
    const { name, value } = e.target;
    setPasswordData((prev) => ({ ...prev, [name]: value }));
    setError('');
    // Reset verification if current password changes
    if (name === 'currentPassword') {
      setPasswordVerified(false);
    }
  };

  const handleVerifyPassword = async () => {
    if (!passwordData.currentPassword) {
      setError('Current password is required');
      return;
    }

    setVerifyingPassword(true);
    setError('');

    try {
      await api.post('/users/me/verify-password', {
        currentPassword: passwordData.currentPassword,
      });
      setPasswordVerified(true);
      setSuccess('Current password verified. You can now change your password.');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setPasswordVerified(false);
      const errorMessage =
        err.response?.data?.message ||
        err.response?.data?.error?.message ||
        err.message ||
        'Current password is incorrect';
      setError(errorMessage);
    } finally {
      setVerifyingPassword(false);
    }
  };

  const togglePasswordVisibility = (field) => {
    setShowPasswords((prev) => ({ ...prev, [field]: !prev[field] }));
  };

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setError('File size must be less than 5MB');
      return;
    }

    if (!file.type.startsWith('image/')) {
      setError('Only image files are allowed');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const formDataObj = new FormData();
      formDataObj.append('avatar', file);

      const response = await api.patch('/users/me/profile', formDataObj, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setSuccess('Avatar updated successfully');
      await fetchMe();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      const errorMessage =
        err.response?.data?.message ||
        err.response?.data?.error?.message ||
        err.message ||
        'Failed to upload avatar';
      setError(errorMessage);
    } finally {
      setLoading(false);
      e.target.value = '';
    }
  };

  const handleSavePersonal = async () => {
    if (!formData.firstName.trim() || !formData.lastName.trim()) {
      setError('First name and last name are required');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await api.patch('/users/me/profile', {
        firstName: formData.firstName,
        lastName: formData.lastName,
        username: formData.username,
        gender: formData.gender || undefined,
        department: formData.department || undefined,
        phone: formData.phone,
        bio: formData.bio,
      });

      setSuccess('Profile updated successfully');
      await fetchMe();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      const errorMessage =
        err.response?.data?.message ||
        err.response?.data?.error?.message ||
        err.message ||
        'Failed to update profile';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async () => {
    if (!passwordVerified) {
      setError('Please verify your current password first');
      return;
    }

    if (!passwordData.newPassword) {
      setError('New password is required');
      return;
    }

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/.test(passwordData.newPassword)) {
      setError('Password must contain uppercase, lowercase, number, and special character');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await api.post('/users/me/change-password', {
        currentPassword: passwordData.currentPassword,
        newPassword: passwordData.newPassword,
      });

      setSuccess('Password changed successfully. Please log in again.');
      setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setTimeout(() => {
        window.location.href = '/login';
      }, 2000);
    } catch (err) {
      // Extract error message from various response formats
      const errorMessage =
        err.response?.data?.message ||
        err.response?.data?.error?.message ||
        err.message ||
        'Failed to change password';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleRequestPasswordReset = async () => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await api.post('/users/me/request-password-reset');
      setSuccess('Password reset link sent to your email');
      setTimeout(() => setSuccess(''), 5000);
    } catch (err) {
      const errorMessage =
        err.response?.data?.message ||
        err.response?.data?.error?.message ||
        err.message ||
        'Failed to request password reset';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const getPasswordStrength = (password) => {
    if (!password) return null;
    const hasUpper = /[A-Z]/.test(password);
    const hasLower = /[a-z]/.test(password);
    const hasNum = /\d/.test(password);
    const hasSpecial = /[@$!%*?&]/.test(password);
    const isLongEnough = password.length >= 8;

    return { hasUpper, hasLower, hasNum, hasSpecial, isLongEnough };
  };

  const strength = getPasswordStrength(passwordData.newPassword);

  return (
    <Layout title="Profile Settings" description="Manage your profile and security settings">
      <div className={styles.page}>
        <div className={styles.container}>
          {/* Header */}
          <div className={styles.header}>
            <h1>Profile Settings</h1>
            <p>Manage your personal information and security preferences</p>
          </div>

          {/* Alert Messages */}
          {error && (
            <div className={styles.alert} style={{ borderLeftColor: '#ef4444' }}>
              <AlertCircle size={16} style={{ color: '#ef4444' }} />
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div className={styles.alert} style={{ borderLeftColor: '#22c55e' }}>
              <Check size={16} style={{ color: '#22c55e' }} />
              <span>{success}</span>
            </div>
          )}

          {/* Tabs */}
          <div className={styles.tabsContainer}>
            <div className={styles.tabs}>
              <button
                className={`${styles.tab} ${activeTab === 'personal' ? styles.active : ''}`}
                onClick={() => setActiveTab('personal')}
              >
                Personal Information
              </button>
              <button
                className={`${styles.tab} ${activeTab === 'security' ? styles.active : ''}`}
                onClick={() => setActiveTab('security')}
              >
                Security
              </button>
            </div>

            {/* Personal Information Tab */}
            {activeTab === 'personal' && (
              <div className={styles.tabContent}>
                {/* Avatar Section */}
                <div className={styles.avatarSection}>
                  <div className={styles.avatarContainer}>
                    <div className={styles.avatar}>
                      {user?.avatar ? (
                        <img src={user.avatar} alt={user.firstName} />
                      ) : (
                        <span>
                          {user?.firstName?.[0]}
                          {user?.lastName?.[0]}
                        </span>
                      )}
                    </div>
                    <button
                      className={styles.avatarButton}
                      onClick={handleAvatarClick}
                      disabled={loading}
                    >
                      <Camera size={16} />
                    </button>
                  </div>
                  <div className={styles.avatarInfo}>
                    <p className={styles.avatarLabel}>Profile Picture</p>
                    <p className={styles.avatarHint}>JPG, PNG or GIF (max 5MB)</p>
                  </div>
                </div>

                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/*"
                  onChange={handleAvatarUpload}
                  style={{ display: 'none' }}
                />

                <hr className={styles.divider} />

                {/* Form Fields */}
                <div className={styles.formGrid}>
                  <div className={styles.formGroup}>
                    <label className={styles.label}>
                      First Name <span className={styles.required}>*</span>
                    </label>
                    <input
                      type="text"
                      name="firstName"
                      value={formData.firstName}
                      onChange={handleInputChange}
                      className={styles.input}
                      disabled={loading}
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.label}>
                      Last Name <span className={styles.required}>*</span>
                    </label>
                    <input
                      type="text"
                      name="lastName"
                      value={formData.lastName}
                      onChange={handleInputChange}
                      className={styles.input}
                      disabled={loading}
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.label}>Username</label>
                    <input
                      type="text"
                      name="username"
                      value={formData.username}
                      onChange={handleInputChange}
                      className={styles.input}
                      disabled={loading}
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.label}>Gender</label>
                    <select
                      name="gender"
                      value={formData.gender}
                      onChange={handleInputChange}
                      className={styles.select}
                      disabled={loading}
                    >
                      <option value="">--None--</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.label}>Department</label>
                    <select
                      name="department"
                      value={formData.department}
                      onChange={handleInputChange}
                      className={styles.select}
                      disabled={loading}
                    >
                      <option value="">--None--</option>
                      <option value="Human Resources">Human Resources</option>
                      <option value="Finance">Finance</option>
                      <option value="Sales and Marketing">Sales and Marketing</option>
                      <option value="Procurement">Procurement</option>
                      <option value="Production">Production</option>
                      <option value="IT">IT</option>
                      <option value="Admin">Admin</option>
                      <option value="Exco">Exco</option>
                    </select>
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.label}>
                      Email <span className={styles.required}>*</span>
                    </label>
                    <input
                      type="email"
                      name="email"
                      value={formData.email}
                      onChange={handleInputChange}
                      className={styles.input}
                      disabled={true}
                      title="Email cannot be changed"
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.label}>Phone</label>
                    <input
                      type="tel"
                      name="phone"
                      value={formData.phone}
                      onChange={handleInputChange}
                      className={styles.input}
                      disabled={loading}
                    />
                  </div>

                  <div className={styles.formGroupFull}>
                    <label className={styles.label}>Bio</label>
                    <textarea
                      name="bio"
                      value={formData.bio}
                      onChange={handleInputChange}
                      className={styles.textarea}
                      placeholder="Tell us about yourself (max 500 characters)"
                      maxLength={500}
                      disabled={loading}
                    />
                    <span className={styles.charCount}>
                      {formData.bio.length}/500
                    </span>
                  </div>
                </div>

                <div className={styles.formActions}>
                  <button
                    className={styles.saveBtn}
                    onClick={handleSavePersonal}
                    disabled={loading}
                  >
                    {loading ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </div>
            )}

            {/* Security Tab */}
            {activeTab === 'security' && (
              <div className={styles.tabContent}>
                <div className={styles.securitySection}>
                  <h3>Change Password</h3>
                  <p className={styles.sectionDescription}>
                    Update your password to keep your account secure
                  </p>

                  <div className={styles.formGroup}>
                    <label className={styles.label}>
                      Current Password <span className={styles.required}>*</span>
                      {passwordVerified && (
                        <span style={{ color: '#22c55e', marginLeft: '8px' }}>
                          ✓ Verified
                        </span>
                      )}
                    </label>
                    <div className={styles.passwordWrapper}>
                      <input
                        type={showPasswords.current ? 'text' : 'password'}
                        name="currentPassword"
                        value={passwordData.currentPassword}
                        onChange={handlePasswordChange}
                        className={styles.input}
                        disabled={passwordVerified || verifyingPassword}
                      />
                      <button
                        type="button"
                        className={styles.togglePassword}
                        onClick={() => togglePasswordVisibility('current')}
                        disabled={passwordVerified || verifyingPassword}
                      >
                        {showPasswords.current ? 'Hide' : 'Show'}
                      </button>
                    </div>
                    {!passwordVerified && (
                      <button
                        type="button"
                        className={styles.verifyBtn}
                        onClick={handleVerifyPassword}
                        disabled={!passwordData.currentPassword || verifyingPassword}
                      >
                        {verifyingPassword ? 'Verifying...' : 'Verify Password'}
                      </button>
                    )}
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.label}>
                      New Password <span className={styles.required}>*</span>
                    </label>
                    <div className={styles.passwordWrapper}>
                      <input
                        type={showPasswords.new ? 'text' : 'password'}
                        name="newPassword"
                        value={passwordData.newPassword}
                        onChange={handlePasswordChange}
                        className={styles.input}
                        disabled={!passwordVerified || loading}
                        title={!passwordVerified ? 'Verify current password first' : ''}
                      />
                      <button
                        type="button"
                        className={styles.togglePassword}
                        onClick={() => togglePasswordVisibility('new')}
                        disabled={!passwordVerified || loading}
                      >
                        {showPasswords.new ? 'Hide' : 'Show'}
                      </button>
                    </div>
                  </div>

                  {strength && (
                    <div className={styles.strengthChecker}>
                      <div
                        className={`${styles.requirement} ${strength.isLongEnough ? styles.met : ''}`}
                      >
                        <span>✓</span> At least 8 characters
                      </div>
                      <div
                        className={`${styles.requirement} ${strength.hasUpper ? styles.met : ''}`}
                      >
                        <span>✓</span> One uppercase letter
                      </div>
                      <div
                        className={`${styles.requirement} ${strength.hasLower ? styles.met : ''}`}
                      >
                        <span>✓</span> One lowercase letter
                      </div>
                      <div
                        className={`${styles.requirement} ${strength.hasNum ? styles.met : ''}`}
                      >
                        <span>✓</span> One number
                      </div>
                      <div
                        className={`${styles.requirement} ${strength.hasSpecial ? styles.met : ''}`}
                      >
                        <span>✓</span> One special character (@$!%*?&)
                      </div>
                    </div>
                  )}

                  <div className={styles.formGroup}>
                    <label className={styles.label}>
                      Confirm Password <span className={styles.required}>*</span>
                    </label>
                    <div className={styles.passwordWrapper}>
                      <input
                        type={showPasswords.confirm ? 'text' : 'password'}
                        name="confirmPassword"
                        value={passwordData.confirmPassword}
                        onChange={handlePasswordChange}
                        className={styles.input}
                        disabled={!passwordVerified || loading}
                        title={!passwordVerified ? 'Verify current password first' : ''}
                      />
                      <button
                        type="button"
                        className={styles.togglePassword}
                        onClick={() => togglePasswordVisibility('confirm')}
                        disabled={!passwordVerified || loading}
                      >
                        {showPasswords.confirm ? 'Hide' : 'Show'}
                      </button>
                    </div>
                  </div>

                  <div className={styles.formActions}>
                    <button
                      className={styles.saveBtn}
                      onClick={handleChangePassword}
                      disabled={!passwordVerified || loading}
                      title={!passwordVerified ? 'Verify current password first' : ''}
                    >
                      {loading ? 'Changing...' : 'Change Password'}
                    </button>
                  </div>
                </div>

                <hr className={styles.divider} />

                <MfaSettings />

                <hr className={styles.divider} />

                <div className={styles.securitySection}>
                  <h3>Password Reset via Email</h3>
                  <p className={styles.sectionDescription}>
                    Request a password reset link to be sent to your email address
                  </p>

                  <div className={styles.formActions}>
                    <button
                      className={styles.secondaryBtn}
                      onClick={handleRequestPasswordReset}
                      disabled={loading}
                    >
                      {loading ? 'Sending...' : 'Send Reset Link'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Profile;
