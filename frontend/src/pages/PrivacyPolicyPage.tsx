import { Link } from 'react-router-dom';

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-[#f8f9fa] py-16 px-4">
      <div className="max-w-3xl mx-auto">
        <Link to="/dashboard" className="inline-flex items-center text-sm text-slate-500 hover:text-slate-900 transition-colors mb-8 font-medium">
          &larr; Back
        </Link>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-10 md:p-14">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Privacy Policy</h1>
          <p className="text-sm text-slate-400 mb-10">Last updated: March 14, 2026</p>

          <div className="space-y-8 text-[15px] leading-relaxed text-slate-700">
            <section>
              <h2 className="text-lg font-semibold text-slate-900 mb-3">1. Information We Collect</h2>
              <p>When you use Noteflow, we collect the following types of information:</p>
              <ul className="list-disc pl-6 mt-3 space-y-1.5">
                <li><strong>Account Information:</strong> Your name, email address, and password when you create an account.</li>
                <li><strong>Content:</strong> Documents you upload (PDF, DOCX, PPTX, TXT, MD, XLSX, CSV, images), notebooks you create, chat messages, and AI-generated outputs.</li>
                <li><strong>Usage Data:</strong> How you interact with our service, including features used, timestamps, and session duration.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-slate-900 mb-3">2. How We Use Your Information</h2>
              <p>We use your information to:</p>
              <ul className="list-disc pl-6 mt-3 space-y-1.5">
                <li>Provide, maintain, and improve the Noteflow service.</li>
                <li>Process your documents and generate AI-powered answers with citations.</li>
                <li>Enable notebook sharing and collaboration features.</li>
                <li>Send service-related notifications and updates.</li>
                <li>Ensure security and prevent abuse.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-slate-900 mb-3">3. Data Storage and Security</h2>
              <p>Your documents and data are stored on secure servers. We use industry-standard encryption for data in transit (TLS) and implement access controls to protect your information. Uploaded documents are processed through our AI pipeline and stored for retrieval purposes only within your notebooks.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-slate-900 mb-3">4. Data Sharing</h2>
              <p>We do not sell your personal information. We may share data only in the following circumstances:</p>
              <ul className="list-disc pl-6 mt-3 space-y-1.5">
                <li><strong>With your consent:</strong> When you share notebooks with other users via invite links.</li>
                <li><strong>Service providers:</strong> We use third-party AI services (language models and embedding services) to process your queries. Document content sent for processing is not retained by these providers beyond the request lifecycle.</li>
                <li><strong>Legal requirements:</strong> When required by law or to protect rights and safety.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-slate-900 mb-3">5. Your Rights</h2>
              <p>You have the right to:</p>
              <ul className="list-disc pl-6 mt-3 space-y-1.5">
                <li>Access your personal data and exported content.</li>
                <li>Delete your notebooks and uploaded documents at any time.</li>
                <li>Delete your account and all associated data.</li>
                <li>Opt out of non-essential communications.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-slate-900 mb-3">6. Cookies</h2>
              <p>We use essential cookies for authentication (JWT tokens stored in httpOnly cookies). We do not use third-party tracking cookies or analytics cookies.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-slate-900 mb-3">7. Changes to This Policy</h2>
              <p>We may update this Privacy Policy from time to time. We will notify you of any material changes by posting the new policy on this page and updating the "Last updated" date.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-slate-900 mb-3">8. Contact Us</h2>
              <p>If you have questions about this Privacy Policy, please contact us at <a href="mailto:support@noteflow.app" className="text-[#5b8c15] hover:underline">support@noteflow.app</a>.</p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
