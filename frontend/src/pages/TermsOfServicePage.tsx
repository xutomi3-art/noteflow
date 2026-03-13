import { Link } from 'react-router-dom';

export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-[#f8f9fa] py-16 px-4">
      <div className="max-w-3xl mx-auto">
        <Link to="/dashboard" className="inline-flex items-center text-sm text-slate-500 hover:text-slate-900 transition-colors mb-8 font-medium">
          &larr; Back
        </Link>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-10 md:p-14">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Terms of Service</h1>
          <p className="text-sm text-slate-400 mb-10">Last updated: March 14, 2026</p>

          <div className="space-y-8 text-[15px] leading-relaxed text-slate-700">
            <section>
              <h2 className="text-lg font-semibold text-slate-900 mb-3">1. Acceptance of Terms</h2>
              <p>By accessing or using Noteflow, you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use the service.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-slate-900 mb-3">2. Description of Service</h2>
              <p>Noteflow is an AI-powered knowledge base application that allows you to upload documents, organize them into notebooks, and interact with your content through AI-generated answers with citation traceability. The service includes document processing, retrieval-augmented generation (RAG), collaborative sharing, and content generation features.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-slate-900 mb-3">3. User Accounts</h2>
              <ul className="list-disc pl-6 space-y-1.5">
                <li>You must provide accurate and complete information when creating an account.</li>
                <li>You are responsible for maintaining the security of your account credentials.</li>
                <li>You must notify us immediately of any unauthorized use of your account.</li>
                <li>One person may not maintain more than one account.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-slate-900 mb-3">4. User Content</h2>
              <p>You retain ownership of all documents and content you upload to Noteflow. By uploading content, you grant us a limited license to process, store, and index your documents for the purpose of providing the service. You represent that you have the right to upload and use all content you provide.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-slate-900 mb-3">5. Acceptable Use</h2>
              <p>You agree not to:</p>
              <ul className="list-disc pl-6 mt-3 space-y-1.5">
                <li>Upload illegal, harmful, or infringing content.</li>
                <li>Attempt to gain unauthorized access to any part of the service.</li>
                <li>Use the service to generate misleading or harmful content.</li>
                <li>Reverse engineer, decompile, or attempt to extract source code from the service.</li>
                <li>Use automated means to access the service beyond the provided API.</li>
                <li>Share your account credentials with others.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-slate-900 mb-3">6. AI-Generated Content</h2>
              <p>Noteflow uses artificial intelligence to generate answers, summaries, FAQs, study guides, mind maps, podcasts, and presentations based on your uploaded documents. While we strive for accuracy, AI-generated content may contain errors or inaccuracies. You are responsible for reviewing and verifying all AI-generated output before relying on it.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-slate-900 mb-3">7. Sharing and Collaboration</h2>
              <p>When you share a notebook, you control access through roles (Owner, Editor, Viewer). You are responsible for managing who has access to your shared notebooks. Invite links can be revoked at any time by the notebook owner.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-slate-900 mb-3">8. Service Availability</h2>
              <p>We strive to maintain high availability but do not guarantee uninterrupted access. We may modify, suspend, or discontinue any part of the service at any time with reasonable notice.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-slate-900 mb-3">9. Limitation of Liability</h2>
              <p>To the maximum extent permitted by law, Noteflow and its operators shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of the service, including but not limited to loss of data, loss of profits, or business interruption.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-slate-900 mb-3">10. Termination</h2>
              <p>We may terminate or suspend your account at any time for violation of these terms. You may delete your account at any time. Upon termination, your data will be deleted in accordance with our Privacy Policy.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-slate-900 mb-3">11. Changes to Terms</h2>
              <p>We reserve the right to modify these terms at any time. Continued use of the service after changes constitutes acceptance of the new terms.</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-slate-900 mb-3">12. Contact</h2>
              <p>For questions about these Terms of Service, please contact us at <a href="mailto:support@noteflow.app" className="text-[#5b8c15] hover:underline">support@noteflow.app</a>.</p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
