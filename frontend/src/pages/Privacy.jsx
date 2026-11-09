import styles from './Privacy.module.css';

export default function Privacy() {
  return (
    <div className={styles.page}>
      <div className={styles.doc}>
        <header className={styles.header}>
          <div className={styles.wordmark}>Salesdam</div>
          <h1 className={styles.h1}>Privacy Policy</h1>
          <div className={styles.meta}>
            <span>Effective date: 9 November 2025</span>
            <span>Last updated: 9 November 2025</span>
          </div>
        </header>

        <nav className={styles.toc}>
          <h2 className={styles.tocTitle}>Contents</h2>
          <ol className={styles.tocList}>
            {['Overview','Data We Collect','How We Use Your Data','Sharing and Disclosure','Data Retention','Security','Your Rights','Third-Party Services','Changes to This Policy','Contact Us'].map((t, i) => (
              <li key={i}><a href={`#s${i+1}`} className={styles.tocLink}>{t}</a></li>
            ))}
          </ol>
        </nav>

        <section id="s1" className={styles.section}>
          <h2 className={styles.h2}><span className={styles.num}>01</span>Overview</h2>
          <p>Salesdam is a business communication platform that enables businesses to manage customer conversations across messaging channels including WhatsApp, SMS, and email from a single inbox.</p>
          <p>This Privacy Policy explains how we collect, use, and protect information when you use the Salesdam platform. It applies to all users of the Salesdam web application, API, and related services.</p>
          <div className={styles.highlight}>Salesdam processes messages and contact data on behalf of the businesses (our customers) that use our platform. Those businesses are responsible for their own data-handling obligations with respect to their end customers.</div>
        </section>

        <section id="s2" className={styles.section}>
          <h2 className={styles.h2}><span className={styles.num}>02</span>Data We Collect</h2>
          <p>We collect information in two categories: account data from businesses using Salesdam, and communication data processed through the platform.</p>
          <table className={styles.table}>
            <thead><tr><th>Category</th><th>Examples</th><th>Source</th></tr></thead>
            <tbody>
              <tr><td><strong>Account information</strong></td><td>Name, email address, organisation name, billing details</td><td>Provided at registration</td></tr>
              <tr><td><strong>Communication data</strong></td><td>Messages, attachments, timestamps, sender and recipient identifiers</td><td>Synced via connected channels</td></tr>
              <tr><td><strong>Contact records</strong></td><td>Phone numbers, names, conversation history</td><td>Created by platform users</td></tr>
              <tr><td><strong>Usage data</strong></td><td>Log files, feature usage, session duration, IP address</td><td>Automatically collected</td></tr>
              <tr><td><strong>Workflow data</strong></td><td>Automation rules, templates, assigned agents, tags</td><td>Created by platform users</td></tr>
            </tbody>
          </table>
        </section>

        <section id="s3" className={styles.section}>
          <h2 className={styles.h2}><span className={styles.num}>03</span>How We Use Your Data</h2>
          <p>We use the data we collect to:</p>
          <ul>
            <li>Provide and operate the Salesdam platform and its features</li>
            <li>Route inbound messages to the correct inbox and team members</li>
            <li>Deliver notifications about new messages and assigned conversations</li>
            <li>Process automation workflows you have configured</li>
            <li>Provide customer support and respond to your enquiries</li>
            <li>Monitor platform health, detect errors, and improve reliability</li>
            <li>Send product updates and administrative communications</li>
            <li>Comply with applicable legal obligations</li>
          </ul>
          <p>We do not sell personal data to third parties, and we do not use communication data to train AI models.</p>
        </section>

        <section id="s4" className={styles.section}>
          <h2 className={styles.h2}><span className={styles.num}>04</span>Sharing and Disclosure</h2>
          <ul>
            <li><strong>Service providers:</strong> Trusted third-party infrastructure providers under data-processing agreements, acting only on our instructions.</li>
            <li><strong>Messaging channel providers:</strong> When you connect WhatsApp Business, messages transit through Meta's infrastructure under Meta's own terms.</li>
            <li><strong>Legal requirements:</strong> We may disclose information if required by law or court order.</li>
            <li><strong>Business transfers:</strong> In the event of a merger or acquisition, data may transfer as part of that transaction with notice to affected users.</li>
          </ul>
        </section>

        <section id="s5" className={styles.section}>
          <h2 className={styles.h2}><span className={styles.num}>05</span>Data Retention</h2>
          <ul>
            <li>Message and conversation history is retained for the duration of your subscription and up to 30 days after account closure.</li>
            <li>Account records are retained for up to 7 years following account closure for legal compliance.</li>
            <li>Usage logs are retained for up to 12 months.</li>
          </ul>
        </section>

        <section id="s6" className={styles.section}>
          <h2 className={styles.h2}><span className={styles.num}>06</span>Security</h2>
          <ul>
            <li>Encryption in transit (TLS 1.2+) for all data transmitted to and from the platform</li>
            <li>Encryption at rest for sensitive credential and secret fields</li>
            <li>Webhook signature verification for all inbound channel payloads</li>
            <li>Role-based access controls and audit logging</li>
          </ul>
        </section>

        <section id="s7" className={styles.section}>
          <h2 className={styles.h2}><span className={styles.num}>07</span>Your Rights</h2>
          <p>Depending on your location, you may have rights to access, correct, delete, export, or restrict processing of your personal data. Contact us to exercise any of these rights. We will respond within 30 days.</p>
        </section>

        <section id="s8" className={styles.section}>
          <h2 className={styles.h2}><span className={styles.num}>08</span>Third-Party Services</h2>
          <p>By connecting WhatsApp Business, messages transit through Meta Platforms, Inc. and are subject to <a href="https://www.whatsapp.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer">WhatsApp's Privacy Policy</a>. We are not responsible for the data-handling practices of third-party services.</p>
        </section>

        <section id="s9" className={styles.section}>
          <h2 className={styles.h2}><span className={styles.num}>09</span>Changes to This Policy</h2>
          <p>When we make material changes, we will notify account administrators by email and update the "Last updated" date above. Continued use of Salesdam after the effective date constitutes acceptance of the updated terms.</p>
        </section>

        <section id="s10" className={styles.section}>
          <h2 className={styles.h2}><span className={styles.num}>10</span>Contact Us</h2>
          <p>For privacy-related questions or data requests:</p>
          <div className={styles.contactCard}>
            <strong>Salesdam — Privacy</strong>
            <p>Email: <span className={styles.email}>privacy@salesdam.com</span></p>
          </div>
        </section>

        <footer className={styles.footer}>
          <p>© 2025 Salesdam. All rights reserved.</p>
        </footer>
      </div>
    </div>
  );
}
