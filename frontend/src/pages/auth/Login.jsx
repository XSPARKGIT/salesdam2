import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { LogIn } from 'lucide-react';
import Button from '../../components/common/Button/Button';
import FormInput from '../../components/common/FormInput/FormInput';
import styles from './Login.module.css';
import { useAuth } from '../../hooks/useAuth';
import { version } from '../../../package.json';

const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();

  // Get username from the URL
  const searchParams = new URLSearchParams(location.search);
  const prefilledUsername = searchParams.get('email') || searchParams.get('username') || '';

  const [formSubmitErrors, setFormSubmitErrors] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [triedEmptyPassword, setTriedEmptyPassword] = useState(false);
  const [triedEmptyUsername, setTriedEmptyUsername] = useState(false);

  const [credentials, setCredentials] = useState({
    username: prefilledUsername,
    password: '',
  });

  const from = location.state?.from?.pathname || '/';

  const handleSubmit = async (event) => {
    event.preventDefault();

    let credentialsEmpty = false;

    if (credentials.password === '') {
      setTriedEmptyPassword(true);
      setFormSubmitErrors('Please enter email and password');
      credentialsEmpty = true;
    }

    if (credentials.username === '') {
      setTriedEmptyUsername(true);
      setFormSubmitErrors('Please enter email and password');
      credentialsEmpty = true;
    }

    if (credentialsEmpty) return;

    setTriedEmptyUsername(false);
    setTriedEmptyPassword(false);
    setIsSubmitting(true);

    try {
      await login(credentials.username, credentials.password);

      navigate(from, { replace: true });
    } catch (error) {
      console.error(error);

      setIsSubmitting(false);

      setFormSubmitErrors(
        error?.response?.data?.message ||
          error?.message ||
          'Please check your email and password.',
      );
    }
  };

  const handleFormChange = (event) => {
    const { name, value } = event.target;

    const sanitizedValue = value.replace(/\s+/g, '');

    setCredentials((prev) => ({
      ...prev,
      [name]: sanitizedValue,
    }));
  };

  return (
    <>
      <Helmet>
        <title>Login | Salesdam</title>
        <meta name="description" content="Sign in to Salesdam CRM" />
      </Helmet>

      <div className={styles.container}>
        <div className={styles.leftPanel}>
          <div className={styles.welcomeContent}>
            <div className={styles.brandSection}>
              <div className={styles.logoText}>Salesdam</div>

              <h1 className={styles.title}>Welcome Back!</h1>

              <p className={styles.description}>
                Recognizing that sales are the lifeblood of any business,
                Salesdam aims to become the vital pulse of your enterprise.
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

              <h2 className={styles.formTitle}>Sign in to your account</h2>

              <p className={styles.formSubtitle}>
                Enter your credentials to access your account
              </p>
            </div>

            <form onSubmit={handleSubmit} noValidate className={styles.form}>
              <FormInput
                id="username"
                label="Email"
                name="username"
                type="text"
                value={credentials.username}
                onChange={handleFormChange}
                autoFocus
                autoComplete="username"
                error={
                  triedEmptyUsername && credentials.username === ''
                    ? 'Username is required'
                    : ''
                }
              />

              <FormInput
                id="password"
                label="Password"
                name="password"
                type="password"
                value={credentials.password}
                onChange={handleFormChange}
                autoComplete="current-password"
                error={
                  triedEmptyPassword && credentials.password === ''
                    ? 'Password is required'
                    : ''
                }
              />

              {formSubmitErrors && (
                <div className={styles.errorMessage}>
                  <LogIn size={16} />
                  <span>{formSubmitErrors}</span>
                </div>
              )}

              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Signing in...' : 'Sign in'}
              </Button>

              <div className={styles.formFooter}>
                <Link className={styles.forgotPassword} to="/forgot-password">
                  Forgot your password?
                </Link>

                <p className={styles.registerText}>
                  Don&apos;t have an account?{' '}
                  <Link to="/register" className={styles.registerLink}>
                    Register
                  </Link>
                </p>
              </div>
            </form>
          </div>

          <footer className={styles.copyright}>
            &copy; {new Date().getFullYear()} Salesdam. All rights reserved.
            <span className={styles.version}>v{version}</span>
          </footer>
        </div>
      </div>
    </>
  );
};

export default Login;
