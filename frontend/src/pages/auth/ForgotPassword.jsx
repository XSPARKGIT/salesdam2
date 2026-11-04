import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { AlertCircle, CheckCircle, ArrowLeft } from 'lucide-react';
import Button from '../../components/common/Button/Button';
import FormInput from '../../components/common/FormInput/FormInput';
import styles from './Login.module.css';
import api from '../../services/api';

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (!email.trim()) {
      setError('Please enter your email address');
      return;
    }

    setIsSubmitting(true);

    try {
      await api.post('/auth/forgot-password', { email });
      setSubmitted(true);
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          err?.message ||
          'Failed to send reset email. Please try again.',
      );
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Helmet>
        <title>Forgot Password | Salesdam</title>
        <meta name="description" content="Reset your Salesdam password" />
      </Helmet>

      <div className={styles.container}>
        <div className={styles.leftPanel}>
          <div className={styles.welcomeContent}>
            <div className={styles.brandSection}>
              <div className={styles.logoText}>Salesdam</div>
              <h1 className={styles.title}>Password Reset</h1>
              <p className={styles.description}>
                Don't worry! We'll help you reset your password and get you back
                into your account.
              </p>
              <Link
                className={styles.learnMoreBtn}
                to="https://www.salesdam.com/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Learn More
              </Link>
            </div>
          </div>
        </div>

        <div className={styles.rightPanel}>
          <div className={styles.formContainer}>
            <div className={styles.formHeader}>
              <img src="/icon.png" alt="Salesdam" className={styles.avatar} />
              <h2 className={styles.formTitle}>
                {submitted ? 'Check Your Email' : 'Reset Your Password'}
              </h2>
              <p className={styles.formSubtitle}>
                {submitted
                  ? 'We sent a password reset link to your email'
                  : 'Enter your email address to receive a password reset link'}
              </p>
            </div>

            {submitted ? (
              <div style={{ marginTop: '2rem', textAlign: 'center' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'center',
                    marginBottom: '1rem',
                  }}
                >
                  <CheckCircle size={48} style={{ color: '#10b981' }} />
                </div>
                <div
                  style={{
                    backgroundColor: '#ecfdf5',
                    border: '1px solid #d1fae5',
                    borderRadius: '8px',
                    padding: '1rem',
                    marginBottom: '1.5rem',
                    textAlign: 'center',
                  }}
                >
                  <p style={{ color: '#065f46', marginBottom: '0.5rem' }}>
                    <strong>Email sent successfully!</strong>
                  </p>
                  <p style={{ color: '#047857', fontSize: '0.9rem' }}>
                    Check your email for a link to reset your password. The link
                    will expire in 2 hours.
                  </p>
                </div>
                <p style={{ color: '#666', marginBottom: '1.5rem' }}>
                  Didn't receive an email? Check your spam folder or try with a
                  different email address.
                </p>
                <Link
                  to="/login"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    color: 'var(--color-primary, #007bff)',
                    textDecoration: 'none',
                    fontWeight: '500',
                  }}
                >
                  <ArrowLeft size={18} />
                  Back to Login
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} noValidate className={styles.form}>
                <FormInput
                  id="email"
                  label="Email"
                  name="email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError('');
                  }}
                  placeholder="Enter your email address"
                  autoFocus
                  autoComplete="email"
                  error={error}
                />

                {!error && (
                  <div className={styles.spacer} />
                )}

                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  fullWidth
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Sending...' : 'Send Reset Link'}
                </Button>

                <div className={styles.formFooter}>
                  <Link
                    to="/login"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      color: 'var(--color-primary, #007bff)',
                      textDecoration: 'none',
                      fontSize: '0.95rem',
                    }}
                  >
                    <ArrowLeft size={16} />
                    Back to Login
                  </Link>
                </div>
              </form>
            )}
          </div>

          <footer className={styles.copyright}>
            &copy; {new Date().getFullYear()} Salesdam. All rights reserved.
          </footer>
        </div>
      </div>
    </>
  );
};

export default ForgotPassword;
